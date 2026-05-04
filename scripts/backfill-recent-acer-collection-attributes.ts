#!/usr/bin/env npx tsx
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { getAttributeOptions, type AttributeCollection } from '@/lib/constants/product-attribute-options'
import { getShortAttributeValue } from '@/lib/constants/attribute-short-values'
import {
  detectKeyboardLayoutFromSource,
  detectColorFromSource,
} from '@/lib/utils/laptop-variant-axes'

interface ProductListRow {
  id: string
  supplier?: { id?: string | null } | null
}

interface ProductCollection {
  id: string
  name: string
  slug: string | null
  type?: string | null
}

interface ProductMetafield {
  namespace: string
  key: string
  value: string | null
}

interface ProductDetail {
  id: string
  title: string
  createdAt: string
  metafields: ProductMetafield[]
  collections: ProductCollection[]
  acerStoreSourceUrl?: string | null
  acerStoreSourceName?: string | null
}

type JsonRecord = Record<string, unknown>

const RECENT_SINCE = '2026-04-29'
const CONCURRENCY = 1
const AUDIT_ONLY = process.argv.includes('--audit')
const onlySkuArg = process.argv.find((arg) => arg.startsWith('--only-skus='))
const ONLY_SKUS = new Set(
  (onlySkuArg?.slice('--only-skus='.length) ?? '')
    .split(',')
    .map((sku) => sku.trim())
    .filter(Boolean)
)

const COLLECTION_BY_SLUG: Record<string, AttributeCollection> = {
  laptops: 'laptops',
  'gaming-laptops': 'laptops',
  'work-laptops': 'laptops',
  monitors: 'monitor',
  'gaming-monitors': 'monitor',
  'ultrawide-monitors': 'monitor',
  'foldable-monitors': 'monitor',
  mice: 'mice',
  'laptop-bags': 'laptop_bags',
  'headsets-earbuds': 'headsets',
  keyboards: 'keyboards',
  controllers: 'controllers',
  'docking-stations': 'docking_stations',
  connectivity: 'connectivity',
  storage: 'storage',
  'graphics-cards': 'graphics_cards',
  projectors: 'projectors',
  audio: 'audio',
  cameras: 'cameras',
  'electric-scooters': 'electric_scooters',
  'gaming-chairs': 'gaming_chairs',
  'gaming-consoles': 'gaming_consoles',
  'gaming-desks': 'gaming_desks',
  webcams: 'webcams',
  'ai-workstations': 'ai_workstations',
  desktops: 'desktops',
  accessories: 'accessories',
}

function readDevVars(): Record<string, string> {
  let dir = process.cwd()
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, '.dev.vars')
    if (fs.existsSync(candidate)) {
      return Object.fromEntries(
        fs.readFileSync(candidate, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.match(/^([A-Z0-9_]+)=(.+)$/))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .map((match) => [match[1], match[2].trim()])
      )
    }
    dir = path.dirname(dir)
  }
  return {}
}

const env = readDevVars()
const baseUrl = env.WIZHARD_URL ?? 'https://wizhard.store'
const bearer = process.env.AGENT_BEARER_TOKEN ?? env.AGENT_BEARER_TOKEN ?? ''
const openAiKey = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? ''

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
  }
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    out['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID
    out['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET
  }
  return { ...out, ...extra }
}

async function apiGet<T>(pathname: string): Promise<T> {
  const res = await fetch(`${baseUrl}${pathname}`, { headers: headers() })
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status} ${await res.text()}`)
  const json = await res.json() as { data: T }
  return json.data
}

async function apiPatch(pathname: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${pathname} -> ${res.status} ${await res.text()}`)
}

async function apiPut(pathname: string, body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${pathname} -> ${res.status} ${await res.text()}`)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeValue(raw: string): string {
  return raw.trim().toLowerCase()
}

function normalizeLoose(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9.+-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function canonicalize(collection: AttributeCollection, key: string, rawValue: string): string {
  const short = getShortAttributeValue(collection, key, rawValue)
  if (short) return short

  const normalizedRaw = normalizeValue(rawValue)
  const options = getAttributeOptions(collection)[key] ?? []
  const exact = options.find((option) => normalizeValue(option) === normalizedRaw)
  if (exact) return exact

  return rawValue.trim()
}

function splitAttrValues(raw: string): string[] {
  return raw
    .split(/[|;/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function determineCollectionOverride(product: ProductDetail): string | null {
  const title = normalizeLoose(product.title)
  const currentSlug = product.collections[0]?.slug ?? null

  if (currentSlug === 'accessories') {
    if (/\bgaming pc\b|\bpc gamer\b|\borion\b/.test(title)) return 'desktops'
    if (/\bultrabook\b|\btravelmate\b|\bswift\b|\baspire\b|\bchromebook\b/.test(title)) return 'work-laptops'
    if (/\bcarry on case\b|\bcarrying case\b|\bbackpack\b|\bbag\b|\bluggage\b/.test(title) || product.id.startsWith('GP.BAG')) return 'laptop-bags'
    if (/\baethon\b|\bkeyboard\b/.test(title) || product.id.startsWith('GP.KBD')) return 'keyboards'
  }

  return null
}

function inferSeriesFromTitle(title: string, collection: AttributeCollection): string | null {
  const normalized = normalizeLoose(title)
  if (collection === 'laptops') {
    if (normalized.includes('travelmate')) return 'TM'
    if (normalized.includes('chromebook')) return 'Chromebook'
    if (normalized.includes('swift')) return 'Swift'
    if (normalized.includes('aspire')) return 'Aspire'
    if (normalized.includes('nitro')) return 'Nitro'
    if (normalized.includes('helios')) return 'Helios'
    if (normalized.includes('triton')) return 'Triton'
  }
  if (collection === 'monitor') {
    if (normalized.includes('nitro')) return 'Nitro'
    if (normalized.includes('ek1')) return 'EK1'
    if (normalized.includes('sa2')) return 'SA2'
    if (normalized.includes('predator xb')) return 'Predator XB'
    if (normalized.includes('predator x')) return 'Predator X'
    if (normalized.includes('cb3')) return 'Acer CB'
  }
  if (collection === 'desktops') {
    if (normalized.includes('predator orion')) return 'Predator Orion'
    if (normalized.includes('veriton')) return 'Veriton'
    if (normalized.includes('aspire c')) return 'Aspire C'
    if (normalized.includes('aspire xc')) return 'Aspire XC'
    if (normalized.includes('nitro')) return 'Nitro'
  }
  return null
}

function inferModelFromTitle(title: string, collection: AttributeCollection): string | null {
  const original = title.trim()
  const beforePipe = original.split('|')[0]?.trim() ?? original
  let cleaned = beforePipe
    .replace(/^Acer\s+/i, '')
    .replace(/^Predator\s+/i, '')
    .replace(/\b(Ultra-thin|Ultraschlankes|Ultrabook|Touchscreen|Touch|Gaming|OLED|AI|Notebook|Laptop|Monitor|Desktop|All-in-One|convertible|Convertible|PC|Computer)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (collection === 'laptops') {
    const codeMatch = original.match(/\b([A-Z]{1,4}\d{1,2}(?:-[A-Z0-9]+)+)\b/)
    if (cleaned) return cleaned
    if (codeMatch) return codeMatch[1]
  }
  if (collection === 'monitor') {
    const codeMatch = original.match(/\b([A-Z]{1,3}\d{2,4}[A-Z0-9-]*)\b/)
    if (codeMatch) return codeMatch[1]
  }
  if (collection === 'desktops') {
    if (cleaned) return cleaned
  }
  if (collection === 'storage' && cleaned) return cleaned
  return cleaned || null
}

function inferProcessorGeneration(processorModel: string | null): string | null {
  if (!processorModel) return null
  const normalized = normalizeLoose(processorModel)
  if (normalized.includes('ryzen 7000')) return 'Ryzen 7000'
  if (normalized.includes('ryzen 8000')) return 'Ryzen 8000'
  if (normalized.includes('ryzen 9000')) return 'Ryzen 9000'
  if (normalized.includes('core ultra')) {
    const num = normalized.match(/\b(1\d{2}|2\d{2}|3\d{2})\b/)?.[1]
    if (num && num.startsWith('1')) return 'Core U S1'
    if (num && (num.startsWith('2') || num.startsWith('3'))) return 'Core U S2'
    return 'Core U S2'
  }
  const intel = normalized.match(/\bi[3579]-?(\d{4,5})\b/)
  if (intel) {
    const digits = intel[1]
    const generation = digits.length >= 5 ? digits.slice(0, 2) : digits.charAt(0)
    if (generation === '10') return '10th Gen'
    if (generation === '12') return '12th Gen'
    if (generation === '13') return '13th Gen'
    if (generation === '14') return '14th Gen'
  }
  return null
}

function inferProcessorBrand(processor: string | null): string | null {
  if (!processor) return null
  const normalized = normalizeLoose(processor)
  if (normalized.includes('intel') || normalized.includes('core')) return 'Intel'
  if (normalized.includes('ryzen') || normalized.includes('amd')) return 'AMD'
  if (normalized.includes('snapdragon') || normalized.includes('sd x')) return 'Qualcomm'
  return null
}

async function fetchSearchSnippet(query: string): Promise<string | null> {
  const url = `https://www.google.com/search?hl=en&q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en;q=0.9',
    },
  })
  if (!response.ok) return null
  const html = await response.text()
  if (!html || /unusual traffic|detected unusual/i.test(html)) return null
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 5000)
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchSourceText(product: ProductDetail): Promise<string> {
  if (!product.acerStoreSourceUrl) return ''
  const response = await fetch(product.acerStoreSourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en;q=0.9',
    },
  })
  if (!response.ok) return ''
  return stripHtmlToText(await response.text())
}

function parseSourceNumber(raw: string): string {
  return raw.replace(',', '.').trim()
}

function normalizeBrand(raw: string): string {
  return raw
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeProcessorFamily(raw: string): string {
  const cleaned = normalizeBrand(raw)
  if (/^intel\s+core\s+ultra\s+9\b/i.test(cleaned)) return 'Core U9'
  if (/^intel\s+core\s+ultra\s+7\b/i.test(cleaned)) return 'Core U7'
  if (/^intel\s+core\s+ultra\s+5\b/i.test(cleaned)) return 'Core U5'
  if (/^intel\s+core\s+7\b/i.test(cleaned)) return 'Core i7'
  if (/^intel\s+core\s+5\b/i.test(cleaned)) return 'Core i5'
  if (/^intel\s+core\s+i3\b/i.test(cleaned)) return 'Core i3'
  if (/^intel\s+core\s+i9\b/i.test(cleaned)) return 'Core i9'
  if (/^intel\s+core\s+i7\b/i.test(cleaned)) return 'Core i7'
  if (/^intel\s+core\s+i5\b/i.test(cleaned)) return 'Core i5'
  if (/^intel\s+n\d{3}\b/i.test(cleaned)) return cleaned.replace(/^Intel\s+/i, '')
  if (/^amd\s+ryzen\s+ai\s+9\b/i.test(cleaned)) return 'AMD Ryzen 9'
  if (/^amd\s+ryzen\s+ai\s+7\b/i.test(cleaned)) return 'AMD Ryzen 7'
  if (/^amd\s+ryzen\s+ai\s+5\b/i.test(cleaned)) return 'AMD Ryzen 5'
  if (/^amd\s+ryzen\s+9\b/i.test(cleaned)) return 'AMD Ryzen 9'
  if (/^amd\s+ryzen\s+7\b/i.test(cleaned)) return 'AMD Ryzen 7'
  if (/^amd\s+ryzen\s+5\b/i.test(cleaned)) return 'AMD Ryzen 5'
  if (/^mediatek\s+kompanio\s+ultra\b/i.test(cleaned)) return cleaned
  return cleaned
}

function inferGenerationFromExactProcessor(raw: string): string | null {
  const cleaned = normalizeBrand(raw)
  if (/^Intel\s+N\d{3}\b/i.test(cleaned)) return 'N-Series'
  if (/^MediaTek\s+Kompanio\s+Ultra\b/i.test(cleaned)) return 'Kompanio Ultra'
  if (/^AMD\s+Ryzen\s+AI\s+\d\b/i.test(cleaned)) return 'Ryzen AI 300'
  if (/^Intel\s+Core\s+Ultra\b/i.test(cleaned)) return 'Core U S2'
  return inferProcessorGeneration(cleaned)
}

function extractBatteryLife(sourceText: string): string | null {
  const patterns = [
    /maximum battery run time\s+(\d+(?:[.,]\d+)?)\s*hours/i,
    /durata massima della batteria\s+(\d+(?:[.,]\d+)?)\s*ore/i,
    /durée maximale de la batterie\s+(\d+(?:[.,]\d+)?)\s*heures/i,
    /akun enimmäiskäyttöaika\s+(\d+(?:[.,]\d+)?)\s*tuntia/i,
    /maximale werkingsduur van batterij\s+(\d+(?:[.,]\d+)?)\s*uur/i,
    /maximale werkduur van batterij\s+(\d+(?:[.,]\d+)?)\s*uren/i,
    /duraci[oó]n [^ ]+ de bater[ií]a \(m[aá]x\.\)\s+(\d+(?:[.,]\d+)?)\s*horas/i,
    /duraci[oó]n m[aá]xima de la bater[ií]a\s+(\d+(?:[.,]\d+)?)\s*horas/i,
  ]
  for (const pattern of patterns) {
    const match = sourceText.match(pattern)
    if (match?.[1]) return parseSourceNumber(match[1])
  }
  return null
}

function extractBluetoothVersion(sourceText: string): string | null {
  const match = sourceText.match(/bluetooth(?: standard)?\s+bluetooth\s+(\d+(?:[.,]\d+)?)/i)
  return match?.[1] ? parseSourceNumber(match[1]) : null
}

function extractProcessorCoreCount(sourceText: string): string | null {
  const direct = sourceText.match(/(?:processor core|processorkern|nombre de core\(s\) du processeur|rdze[ńn] procesora)[^0-9]{0,50}(\d+)\s*[- ]?core/i)
  if (direct?.[1]) return direct[1]
  const wordMatch = sourceText.match(/\b(quad|octa|deca|tetradeca)[ -]?core\b/i)
  if (!wordMatch) return null
  const map: Record<string, string> = {
    quad: '4',
    octa: '8',
    deca: '10',
    tetradeca: '14',
  }
  return map[wordMatch[1].toLowerCase()] ?? null
}

function extractMaximumMemory(sourceText: string): string | null {
  const match = sourceText.match(/(?:maximum memory|maximale geheugen|mémoire maximale|maximale hoeveelheid geheugen)\s+(\d+(?:[.,]\d+)?)\s*(gb|go)/i)
  if (!match?.[1]) return null
  return parseSourceNumber(match[1])
}

function extractScreenTypeFromPanel(panelType: string | null | undefined, sourceText: string): string | null {
  const haystack = `${panelType ?? ''} ${sourceText}`.toLowerCase()
  if (haystack.includes('mini led')) return 'Mini LED'
  if (haystack.includes('oled')) return 'OLED'
  if (haystack.includes('ips') || haystack.includes('in-plane switching')) return 'IPS'
  if (haystack.includes(' tn ') || haystack.includes('(tn)') || haystack.includes('tn matte')) return 'TN'
  if (haystack.includes(' va ')) return 'VA'
  return null
}

function extractStorageType(currentStorage: string | null | undefined, sourceText: string): string | null {
  const haystack = `${currentStorage ?? ''} ${sourceText}`.toLowerCase()
  if (haystack.includes('ufs')) return 'UFS Flash'
  if (haystack.includes('pcie 5.0') || haystack.includes('pci express nvme 5.0')) return 'NVMe 5.0'
  if (haystack.includes('pcie 4.0') || haystack.includes('pci express nvme 4.0')) return 'NVMe 4.0'
  if (haystack.includes('nvme')) return 'NVMe SSD'
  if (haystack.includes('ssd')) return 'SSD'
  return null
}

function extractExactProcessor(sourceText: string): string | null {
  const patterns = [
    /MediaTek\s+Kompanio\s+Ultra\s+\d+/i,
    /Intel®?\s+N\d{3}/i,
    /Intel®?\s+Core™?\s+i[3579]-N\d{3}/i,
    /Intel®?\s+Core™?\s+Ultra\s+\d\s+\d+[A-Z]?/i,
    /Intel®?\s+Core™?\s+\d\s+\d+[A-Z]?/i,
    /AMD\s+Ryzen™?\s+AI\s+\d\s+\d+/i,
    /AMD\s+Ryzen™?\s+\d\s+\d+[A-Z]?/i,
  ]
  for (const pattern of patterns) {
    const match = sourceText.match(pattern)
    if (match?.[0]) return normalizeBrand(match[0])
  }
  return null
}

function extractGraphicsModel(sourceText: string): string | null {
  const patterns = [
    /ARM®?\s+Immortalis-G\d+\s+MC\d+/i,
    /Intel®?\s+Graphics/i,
    /Arc™?\s+Graphics(?:\s+\d+V)?/i,
    /Radeon™?\s+Graphics/i,
    /GeForce\s+RTX™?\s+\d+/i,
    /UHD\s+Graphics/i,
  ]
  for (const pattern of patterns) {
    const match = sourceText.match(pattern)
    if (match?.[0]) return normalizeBrand(match[0])
  }
  return null
}

function inferGpuBrandFromModel(gpu: string | null | undefined): string | null {
  const cleaned = normalizeBrand(gpu ?? '')
  if (!cleaned) return null
  if (/^arm\b/i.test(cleaned)) return 'ARM'
  if (/intel|arc|uhd/i.test(cleaned)) return 'Intel'
  if (/radeon|amd/i.test(cleaned)) return 'AMD'
  if (/geforce|nvidia|rtx/i.test(cleaned)) return 'NVIDIA'
  return null
}

function extractValuesFromSourceText(
  collection: AttributeCollection,
  currentValues: Record<string, string>,
  sourceText: string,
): Record<string, string> {
  const values: Record<string, string> = {}
  if (!sourceText.trim()) return values

  if (collection === 'laptops' || collection === 'desktops') {
    const exactProcessor = extractExactProcessor(sourceText)
    if (exactProcessor) {
      if (!currentValues.processor) values.processor = normalizeProcessorFamily(exactProcessor)
      if (!currentValues.processor_model) values.processor_model = exactProcessor.replace(/^Intel\s+/i, '').replace(/^AMD\s+/i, '').replace(/^MediaTek\s+/i, '').trim()
      if (!currentValues.processor_brand) {
        if (/^Intel/i.test(exactProcessor)) values.processor_brand = 'Intel'
        else if (/^AMD/i.test(exactProcessor)) values.processor_brand = 'AMD'
        else if (/^MediaTek/i.test(exactProcessor)) values.processor_brand = 'MediaTek'
      }
      if (!currentValues.processor_generation) {
        const generation = inferGenerationFromExactProcessor(exactProcessor)
        if (generation) values.processor_generation = generation
      }
    }

    if (!currentValues.processor_cores) {
      const cores = extractProcessorCoreCount(sourceText)
      if (cores) values.processor_cores = cores
    }
  }

  if (collection === 'laptops') {
    if (!currentValues.screen_type) {
      const screenType = extractScreenTypeFromPanel(currentValues.panel_type, sourceText)
      if (screenType) values.screen_type = screenType
    }
    if (!currentValues.battery_life) {
      const batteryLife = extractBatteryLife(sourceText)
      if (batteryLife) values.battery_life = batteryLife
    }
    if (!currentValues.bluetooth) {
      const bluetooth = extractBluetoothVersion(sourceText)
      if (bluetooth) values.bluetooth = bluetooth
    }
    if (!currentValues.ram_max) {
      const ramMax = extractMaximumMemory(sourceText)
      if (ramMax) values.ram_max = ramMax
    }
    if (!currentValues.storage_type) {
      const storageType = extractStorageType(currentValues.storage, sourceText)
      if (storageType) values.storage_type = storageType
    }
    if (!currentValues.gpu) {
      const gpu = extractGraphicsModel(sourceText)
      if (gpu) values.gpu = gpu
    }
    if (!currentValues.gpu_brand) {
      const gpuBrand = inferGpuBrandFromModel(currentValues.gpu ?? values.gpu)
      if (gpuBrand) values.gpu_brand = gpuBrand
    }
  }

  return values
}

function deterministicValues(product: ProductDetail, collection: AttributeCollection): Record<string, string> {
  const title = product.title
  const titleLoose = normalizeLoose(title)
  const sourceUrl = product.acerStoreSourceUrl ?? null
  const sourceName = product.acerStoreSourceName ?? null
  const values: Record<string, string> = {}

  if (collection === 'laptops') {
    values.brand = /\bpredator\b/i.test(title) ? 'Predator' : 'Acer'
    if (/\bpredator\b/i.test(title)) values.category = 'Gaming'
    else if (/\bspin\b|\bconvertible\b|\b2-in-1\b/.test(titleLoose)) values.category = '2-in-1'
    else if (/\btravelmate\b|\bchromebook\b/.test(titleLoose)) values.category = 'Business'
    else if (/\bswift\b|\baspire\b/.test(titleLoose)) values.category = 'Everyday'
    const series = inferSeriesFromTitle(title, collection)
    if (series) values.series = series
    const model = inferModelFromTitle(title, collection)
    if (model) values.model = model
    const keyboard = detectKeyboardLayoutFromSource(sourceUrl)
    if (keyboard) values.keyboard_layout = keyboard
    const color = detectColorFromSource(sourceName, title, sourceUrl)
    if (color) values.color = color
    if (/\btouch\b|\btouchscreen\b|\btactile\b|\btactil\b/.test(titleLoose)) values.touchscreen = 'Yes'
    if (/\boled\b/.test(titleLoose)) values.screen_type = 'OLED'
    else if (/\bips\b/.test(titleLoose)) values.screen_type = 'IPS'
    if (values.processor) {
      const brand = inferProcessorBrand(values.processor)
      if (brand) values.processor_brand = brand
      values.processor_model = values.processor
      const generation = inferProcessorGeneration(values.processor)
      if (generation) values.processor_generation = generation
    }
  }

  if (collection === 'monitor') {
    values.brand = /\bpredator\b/i.test(title) ? 'Predator' : 'Acer'
    values.product_subtype = /\bgaming\b/i.test(title) ? 'Gaming monitor' : /\bcurved\b/i.test(title) ? 'Curved monitor' : 'Monitor'
    values.category = /\bgaming\b/i.test(title) ? 'Gaming' : /\bcurved\b/i.test(title) ? 'Ultrawide' : 'Office'
    const series = inferSeriesFromTitle(title, collection)
    if (series) values.series = series
    const model = inferModelFromTitle(title, collection)
    if (model) values.model = model
    if (/\bcurved\b/i.test(title)) values.curved = '1800R'
    const color = detectColorFromSource(sourceName, title, sourceUrl)
    if (color) values.color = color
  }

  if (collection === 'desktops') {
    values.product_subtype = /\ball-in-one\b/i.test(title) ? 'All-in-one desktop' : /\bgaming pc\b/i.test(title) ? 'Gaming desktop' : /\bmini\b/i.test(title) ? 'Mini desktop' : 'Desktop'
    const series = inferSeriesFromTitle(title, collection)
    if (series) values.series = series
    values.color = detectColorFromSource(sourceName, title, sourceUrl) ?? 'Black'
    if (/\ball-in-one\b/i.test(title)) {
      const sizeMatch = title.match(/\bS(24|27)\b/i)
      if (sizeMatch) {
        values.screen_size = sizeMatch[1]
        values.aspect_ratio = '16:9'
        values.resolution = '1920x1080'
      }
    }
    if (values.processor) {
      const brand = inferProcessorBrand(values.processor)
      if (brand) values.processor_brand = brand
      values.processor_model = values.processor
    }
  }

  if (collection === 'storage') {
    values.product_subtype = 'Internal SSD'
    if (/\b1 tb\b|\b1tb\b/i.test(title)) values.capacity = '1TB'
    if (/\b2 tb\b|\b2tb\b/i.test(title)) values.capacity = '2TB'
    if (/\b4 tb\b|\b4tb\b/i.test(title)) values.capacity = '4TB'
  }

  if (collection === 'docking_stations') {
    values.product_subtype = /\bstand\b/i.test(title) ? 'Laptop stand with hub' : 'Docking station'
    values.host_connection = 'USB-C'
  }

  if (collection === 'gaming_desks') values.product_subtype = 'Gaming desk'
  if (collection === 'mice' && /\bmouse pad\b/i.test(title)) values.product_subtype = 'Mousepad'
  if (collection === 'electric_scooters') values.product_subtype = 'Electric scooter'
  if (collection === 'laptop_bags') values.product_subtype = /\bcase\b/i.test(title) ? 'Carrying case' : 'Backpack'
  if (collection === 'keyboards') values.product_subtype = 'Gaming keyboard'
  if (collection === 'accessories') {
    if (/\bcharger\b/i.test(title)) values.product_subtype = 'GaN charger'
    else if (/\bpen\b/i.test(title)) values.product_subtype = 'Active stylus'
  }

  return values
}

function buildPrompt(
  product: ProductDetail,
  collection: AttributeCollection,
  missingKeys: string[],
  rawSpecs: Array<{ label: string; value: string }>,
): string {
  const options = getAttributeOptions(collection)
  const lines = missingKeys.map((key) => {
    const allowed = options[key] ?? []
    return `- ${key}: ${allowed.join(', ')}`
  }).join('\n')

  const specLines = rawSpecs.slice(0, 200).map((row) => `- ${row.label}: ${row.value}`).join('\n')

  return [
    `You are extracting product attributes for a ${collection} product.`,
    `Product title: ${product.title}`,
    `Product source URL: ${product.acerStoreSourceUrl ?? 'unknown'}`,
    `Return only the requested keys as a JSON object.`,
    `Use only values from the allowed lists below when possible.`,
    `If multiple allowed values apply for one key, join them with " | ".`,
    `If the source specs do not support a key and you cannot infer it reliably from the title/specs, return null.`,
    `Allowed values by key:\n${lines}`,
    `Raw source specs:\n${specLines}`,
  ].join('\n')
}

async function scrapeSpecRows(page: Page, product: ProductDetail): Promise<Array<{ label: string; value: string }>> {
  if (!product.acerStoreSourceUrl) return []
  await page.goto(product.acerStoreSourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(3000)
  try {
    const cookieBtn = await page.$('#onetrust-accept-btn-handler, .accept-cookies, [id*="accept"], [class*="cookie"] button')
    if (cookieBtn) {
      await cookieBtn.click()
      await page.waitForTimeout(700)
    }
  } catch {
    // ignore cookie failures
  }
  try {
    const elements = await page.$$('a, button, [role="tab"], [data-role="trigger"], li.item.title')
    for (const el of elements) {
      const text = await el.textContent()
      if (text && /spec/i.test(text.trim())) {
        await el.click({ force: true })
        await page.waitForTimeout(1500)
        break
      }
    }
  } catch {
    // ignore tab failures
  }

  return page.evaluate(() => {
    const out: Array<{ label: string; value: string }> = []

    document.querySelectorAll('.additional-attributes tr, table.data.table tr, .product-specifications tr').forEach((row) => {
      const label = row.querySelector('th, .label, td:first-child')?.textContent?.trim() ?? ''
      const value = row.querySelector('td, .data, td:last-child')?.textContent?.trim() ?? ''
      if (label && value && label !== value) out.push({ label, value })
    })

    document.querySelectorAll('dt').forEach((dt) => {
      const dd = dt.nextElementSibling
      const label = dt.textContent?.trim() ?? ''
      const value = dd?.tagName === 'DD' ? (dd.textContent?.trim() ?? '') : ''
      if (label && value && label !== value) out.push({ label, value })
    })

    document.querySelectorAll('.product.attribute').forEach((el) => {
      const label = el.querySelector('.type')?.textContent?.trim() ?? ''
      const value = el.querySelector('.value')?.textContent?.trim() ?? ''
      if (label && value && label !== value) out.push({ label, value })
    })

    document.querySelectorAll('.spec-row, .spec-item, .specification-row, [class*="spec"] li').forEach((el) => {
      const children = Array.from(el.children)
      const label = children.length >= 2 ? (children[0].textContent?.trim() ?? '') : ''
      const value = children.length >= 2 ? (children[1].textContent?.trim() ?? '') : ''
      if (label && value && label !== value) out.push({ label, value })
    })

    document.querySelectorAll('table tr').forEach((row) => {
      const cells = row.querySelectorAll('td, th')
      const label = cells.length === 2 ? (cells[0].textContent?.trim() ?? '') : ''
      const value = cells.length === 2 ? (cells[1].textContent?.trim() ?? '') : ''
      if (label && value && label !== value) out.push({ label, value })
    })

    const dedup = new Map<string, { label: string; value: string }>()
    for (const row of out) dedup.set(`${row.label}::${row.value}`, row)
    return Array.from(dedup.values())
  })
}

async function extractMissingValues(
  product: ProductDetail,
  collection: AttributeCollection,
  missingKeys: string[],
  rawSpecs: Array<{ label: string; value: string }>,
): Promise<Record<string, string>> {
  if (!openAiKey || missingKeys.length === 0 || rawSpecs.length === 0) return {}
  const searchSnippet = await fetchSearchSnippet(`${product.id} ${product.title} site:store.acer.com`)
  let content = '{}'
  let lastError: string | null = null
  for (const delayMs of [0, 4000, 12000]) {
    if (delayMs > 0) await sleep(delayMs)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Return a strict JSON object. Keys must exactly match the requested attribute keys. Values must be strings or null.',
          },
          {
            role: 'user',
            content: `${buildPrompt(product, collection, missingKeys, rawSpecs)}\nGoogle search snippet (optional fallback evidence):\n${searchSnippet ?? 'none'}`,
          },
        ],
      }),
    })
    if (!response.ok) {
      lastError = `OpenAI extraction failed: ${response.status} ${await response.text()}`
      if (response.status >= 500) continue
      throw new Error(lastError)
    }
    const json = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> }
    content = json.choices?.[0]?.message?.content ?? '{}'
    lastError = null
    break
  }
  if (lastError) throw new Error(lastError)
  const extracted = JSON.parse(content) as JsonRecord
  const out: Record<string, string> = {}

  for (const key of missingKeys) {
    const raw = extracted[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const parts = splitAttrValues(trimmed).map((part) => canonicalize(collection, key, part))
    if (parts.length === 0) continue
    out[key] = Array.from(new Set(parts)).join(' | ')
  }

  return out
}

async function runConcurrent<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

async function main(): Promise<void> {
  if (!bearer) throw new Error('AGENT_BEARER_TOKEN missing')
  if (!openAiKey) throw new Error('OPENAI_API_KEY missing')
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'en-GB',
    extraHTTPHeaders: {
      'Accept-Language': 'en-GB,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  const page = await context.newPage()
  const rows = await apiGet<ProductListRow[]>('/api/products?page=1&perPage=1000')
  const acerRows = rows.filter((row) => row.supplier?.id === 'acer')
  const changedSkus = new Set<string>()
  let reclassified = 0
  let attrsUpdated = 0
  let inspected = 0
  let failed = 0
  let missingSkuCount = 0
  const missingByCollection: Record<string, Record<string, number>> = {}
  const missingSamples: Array<{ sku: string; missing: Array<{ collection: string; keys: string[] }> }> = []

  try {
    await runConcurrent(acerRows, CONCURRENCY, async (row) => {
      try {
      if (ONLY_SKUS.size > 0 && !ONLY_SKUS.has(row.id)) return
      const product = await apiGet<ProductDetail>(`/api/products/${encodeURIComponent(row.id)}`)
      if (!product.createdAt || product.createdAt < RECENT_SINCE) return
      inspected += 1

    const overrideSlug = determineCollectionOverride(product)
    if (overrideSlug && overrideSlug !== product.collections[0]?.slug) {
      await apiPatch(`/api/products/${encodeURIComponent(product.id)}`, {
        fields: { categoryIds: [overrideSlug] },
        triggeredBy: 'agent',
      })
      product.collections = [{ id: overrideSlug, name: overrideSlug, slug: overrideSlug, type: 'product' }]
      changedSkus.add(product.id)
      reclassified += 1
      console.log(`[reclassify] ${product.id}: ${overrideSlug}`)
    }

    const slugs = product.collections.map((collection) => collection.slug).filter((slug): slug is string => Boolean(slug))
    const attrCollections = Array.from(new Set(slugs.map((slug) => COLLECTION_BY_SLUG[slug]).filter(Boolean)))
    const attrMap = new Map(
      product.metafields
        .filter((metafield) => metafield.namespace === 'attributes' && (metafield.value ?? '').trim().length > 0)
        .map((metafield) => [metafield.key.trim().toLowerCase(), String(metafield.value).trim()])
    )

    const pendingUpdates: Array<{ key: string; value: string }> = []
    const missingForProduct: Array<{ collection: string; keys: string[] }> = []

    for (const collection of attrCollections) {
      const requiredKeys = Object.keys(getAttributeOptions(collection))
      const currentMissing = requiredKeys.filter((key) => !attrMap.get(key))
      if (currentMissing.length === 0) continue

      missingForProduct.push({ collection, keys: currentMissing })
      missingByCollection[collection] ??= {}
      for (const key of currentMissing) {
        missingByCollection[collection][key] = (missingByCollection[collection][key] ?? 0) + 1
      }

      const deterministic = deterministicValues(product, collection)
      for (const key of currentMissing) {
        const value = deterministic[key]
        if (!value) continue
        pendingUpdates.push({ key, value: canonicalize(collection, key, value) })
        attrMap.set(key, value)
      }

      const remaining = requiredKeys.filter((key) => !attrMap.get(key))
      if (remaining.length === 0) continue

      if (AUDIT_ONLY) continue

      const currentValues = Object.fromEntries(Array.from(attrMap.entries()))
      const sourceText = await fetchSourceText(product)
      const sourceValues = extractValuesFromSourceText(collection, currentValues, sourceText)
      for (const key of remaining) {
        const value = sourceValues[key]
        if (!value) continue
        pendingUpdates.push({ key, value: canonicalize(collection, key, value) })
        attrMap.set(key, value)
      }

      const afterSource = requiredKeys.filter((key) => !attrMap.get(key))
      if (afterSource.length === 0) continue

      console.log(`[inspect] ${product.id}: ${collection} missing ${afterSource.join(', ')}`)
      const rawSpecs = await scrapeSpecRows(page, product)
      const extracted = await extractMissingValues(product, collection, afterSource, rawSpecs)
      for (const [key, value] of Object.entries(extracted)) {
        if (!value.trim()) continue
        pendingUpdates.push({ key, value })
        attrMap.set(key, value)
      }
    }

    if (missingForProduct.length > 0 && missingSamples.length < 50) {
      missingSamples.push({ sku: product.id, missing: missingForProduct })
    }
    if (missingForProduct.length > 0) missingSkuCount += 1

    if (AUDIT_ONLY) return

    const deduped = Array.from(
      new Map(pendingUpdates.map((update) => [update.key, update])).values()
    )
      if (deduped.length === 0) return

      await apiPut(`/api/products/${encodeURIComponent(product.id)}/attributes`, {
        mode: 'merge',
        triggeredBy: 'agent',
        attributes: deduped.map((update) => ({
          key: update.key,
          value: update.value,
          type: 'single_line_text_field',
        })),
      })

      changedSkus.add(product.id)
      attrsUpdated += 1
      console.log(`[attributes] ${product.id}: ${deduped.map((update) => `${update.key}=${update.value}`).join(', ')}`)
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[error] ${row.id}: ${message}`)
      }
    })

    for (const sku of changedSkus) {
      await apiPatch(`/api/products/${encodeURIComponent(sku)}/push-status`, {
        platform: 'shopify_komputerzz',
        status: '2push',
      })
    }

    if (AUDIT_ONLY) {
      console.log(JSON.stringify({
        inspected,
        missingSkus: missingSkuCount,
        missingByCollection,
        samples: missingSamples,
      }, null, 2))
      return
    }

    console.log(`[done] inspected=${inspected} reclassified=${reclassified} attrsUpdated=${attrsUpdated} queuedKomputerzz=${changedSkus.size} failed=${failed}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

import fs from 'fs'
import path from 'path'

function readDevVars() {
  let dir = process.cwd()
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, '.dev.vars')
    if (fs.existsSync(candidate)) {
      return Object.fromEntries(
        fs.readFileSync(candidate, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.match(/^([A-Z0-9_]+)=(.+)$/))
          .filter(Boolean)
          .map((match) => [match[1], match[2].trim()])
      )
    }
    dir = path.dirname(dir)
  }
  return {}
}

const env = readDevVars()
const bearer = process.env.AGENT_BEARER_TOKEN ?? env.AGENT_BEARER_TOKEN ?? ''
const baseUrl = env.WIZHARD_URL ?? 'https://wizhard.store'
const accessHeaders = env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET
  ? {
      'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
    }
  : {}

const backupRoot = path.join(process.cwd(), 'tmp', 'transparentize-white-backup')
const edgeManifestPath = path.join(process.cwd(), 'tmp', 'transparentize-white-edge-previews', 'manifest.json')
const backupManifestPath = path.join(backupRoot, 'manifest.json')

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${bearer}`,
    ...accessHeaders,
    ...extra,
  }
}

async function apiGet(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`, { headers: headers() })
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status} ${await res.text()}`)
  const json = await res.json()
  return json.data
}

async function uploadReplacementSet(sku, files) {
  const form = new FormData()
  form.append('mode', 'replace')
  form.append('triggeredBy', 'agent')
  for (const [index, file] of files.entries()) {
    form.append('files', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.filename)
    form.append(`alt_${index}`, file.alt ?? '')
  }
  const res = await fetch(`${baseUrl}/api/products/${encodeURIComponent(sku)}/images/upload`, {
    method: 'POST',
    headers: headers(),
    body: form,
  })
  if (!res.ok) throw new Error(`POST /api/products/${sku}/images/upload -> ${res.status} ${await res.text()}`)
}

function averagePixel(pixels) {
  const total = pixels.reduce((acc, pixel) => {
    acc[0] += pixel[0]
    acc[1] += pixel[1]
    acc[2] += pixel[2]
    acc[3] += pixel[3]
    return acc
  }, [0, 0, 0, 0])
  return total.map((value) => value / Math.max(pixels.length, 1))
}

function colorDistance(a, b) {
  return Math.sqrt(
    ((a[0] - b[0]) ** 2)
      + ((a[1] - b[1]) ** 2)
      + ((a[2] - b[2]) ** 2)
      + ((((a[3] ?? 255) - (b[3] ?? 255)) ** 2) / 4)
  )
}

async function transparentizeLow(sharp, originalBuffer) {
  const { data, info } = await sharp(originalBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixelAt = (x, y) => {
    const offset = (y * info.width + x) * info.channels
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]
  }

  const corners = []
  for (const [startX, startY] of [[0, 0], [Math.max(0, info.width - 4), 0], [0, Math.max(0, info.height - 4)], [Math.max(0, info.width - 4), Math.max(0, info.height - 4)]]) {
    const patch = []
    for (let y = startY; y < Math.min(info.height, startY + 4); y += 1) {
      for (let x = startX; x < Math.min(info.width, startX + 4); x += 1) {
        patch.push(pixelAt(x, y))
      }
    }
    corners.push(averagePixel(patch))
  }
  const bg = averagePixel(corners)
  const out = Buffer.from(data)
  const innerThreshold = 14
  const featherThreshold = 26

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      const pixel = [out[offset], out[offset + 1], out[offset + 2], out[offset + 3]]
      if (pixel[3] < 8) {
        out[offset + 3] = 0
        continue
      }
      const distance = colorDistance(pixel, bg)
      if (distance <= innerThreshold) {
        out[offset + 3] = 0
      } else if (distance < featherThreshold) {
        const ratio = (distance - innerThreshold) / Math.max(featherThreshold - innerThreshold, 1)
        out[offset + 3] = Math.max(0, Math.min(255, Math.round(pixel[3] * ratio)))
      }
    }
  }

  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).png().toBuffer()
}

async function main() {
  if (!fs.existsSync(edgeManifestPath)) throw new Error('Edge manifest not found')
  const edgeManifest = JSON.parse(fs.readFileSync(edgeManifestPath, 'utf8'))
  const backupManifest = fs.existsSync(backupManifestPath)
    ? JSON.parse(fs.readFileSync(backupManifestPath, 'utf8'))
    : { appliedCount: 0, checkedImages: 0, applied: [] }

  const { default: sharp } = await import('sharp')
  const bySku = new Map()
  for (const edge of edgeManifest.edgeCases ?? []) {
    const list = bySku.get(edge.sku) ?? []
    list.push(edge)
    bySku.set(edge.sku, list)
  }

  const processedLowSkus = new Set(
    (backupManifest.applied ?? [])
      .filter((product) => (product.changedImages ?? []).some((image) => image.confidence === 'low'))
      .map((product) => product.sku)
  )

  let appliedProducts = 0
  for (const [sku, edges] of bySku.entries()) {
    if (processedLowSkus.has(sku)) continue
    const detail = await apiGet(`/api/products/${encodeURIComponent(sku)}`)
    const images = (detail.images ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    if (images.length === 0) continue

    const edgeByIndex = new Map(edges.map((edge) => [edge.index, edge]))
    const productBackupDir = path.join(backupRoot, sku)
    fs.mkdirSync(productBackupDir, { recursive: true })

    const files = []
    const changedImages = []
    for (const [index, image] of images.entries()) {
      const response = await fetch(image.url)
      if (!response.ok) throw new Error(`Failed to fetch ${image.url}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const mimeType = response.headers.get('content-type') || 'image/jpeg'
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : 'jpg'
      const backupPath = path.join(productBackupDir, `${String(index).padStart(2, '0')}-original.${ext}`)
      if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, buffer)

      if (edgeByIndex.has(index)) {
        const transformed = await transparentizeLow(sharp, buffer)
        files.push({
          buffer: transformed,
          filename: `${sku}-${String(index).padStart(2, '0')}.png`,
          mimeType: 'image/png',
          alt: image.alt ?? '',
        })
        changedImages.push({
          index,
          originalUrl: image.url,
          backupPath,
          metrics: edgeByIndex.get(index).metrics,
          confidence: 'low',
        })
      } else {
        files.push({
          buffer,
          filename: `${sku}-${String(index).padStart(2, '0')}.${ext}`,
          mimeType,
          alt: image.alt ?? '',
        })
      }
    }

    if (changedImages.length === 0) continue
    await uploadReplacementSet(sku, files)
    backupManifest.applied.push({
      sku,
      title: detail.title,
      changedImages,
      totalImages: images.length,
    })
    backupManifest.appliedCount = (backupManifest.applied ?? []).length
    fs.writeFileSync(backupManifestPath, JSON.stringify(backupManifest, null, 2))
    appliedProducts += 1
    console.log(`[transparentize-low] ${sku}: changed=${changedImages.length}/${images.length}`)
  }

  backupManifest.appliedCount = (backupManifest.applied ?? []).length
  fs.writeFileSync(backupManifestPath, JSON.stringify(backupManifest, null, 2))
  console.log(`[transparentize-low] applied_products=${appliedProducts}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

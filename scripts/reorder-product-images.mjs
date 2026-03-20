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

async function apiPut(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${pathname} -> ${res.status} ${await res.text()}`)
}

async function fetchAllProductIds() {
  const out = []
  let page = 1
  while (true) {
    const res = await fetch(`${baseUrl}/api/products?page=${page}&perPage=200`, { headers: headers() })
    if (!res.ok) throw new Error(`GET /api/products?page=${page} -> ${res.status} ${await res.text()}`)
    const json = await res.json()
    out.push(...(json.data ?? []).map((row) => row.id))
    const totalPages = json.meta?.pagination?.totalPages ?? page
    if (page >= totalPages) break
    page += 1
  }
  return out
}

function scoreKeywordSignal(image, index) {
  const text = `${image.url} ${image.alt ?? ''}`.toLowerCase()
  let score = 0
  if (index === 0) score += 4
  if (/transparent|packshot|studio|isolated|white|black/.test(text)) score += 5
  if (/front|main|primary|hero/.test(text)) score += 3
  if (/lifestyle|ambient|room|desk|setup|scene/.test(text)) score -= 5
  if (/thumbnail|thumb|icon|logo|banner|swatch/.test(text)) score -= 8
  return score
}

function colorDistance(a, b) {
  return Math.sqrt(
    ((a[0] - b[0]) ** 2)
      + ((a[1] - b[1]) ** 2)
      + ((a[2] - b[2]) ** 2)
      + ((((a[3] ?? 255) - (b[3] ?? 255)) ** 2) / 4)
  )
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

function stddev(pixels, mean) {
  const variance = pixels.reduce((acc, pixel) => {
    const dr = pixel[0] - mean[0]
    const dg = pixel[1] - mean[1]
    const db = pixel[2] - mean[2]
    return acc + ((dr * dr) + (dg * dg) + (db * db))
  }, 0) / Math.max(pixels.length, 1)
  return Math.sqrt(variance / 3)
}

async function scoreImage(sharp, image, index) {
  try {
    const response = await fetch(image.url)
    if (!response.ok) return { image, index, score: -999, why: 'fetch_failed' }
    const buffer = Buffer.from(await response.arrayBuffer())
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .resize({ width: 96, height: 96, fit: 'inside', withoutEnlargement: false })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const pixels = []
    const borderPixels = []
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const offset = (y * info.width + x) * info.channels
        const pixel = [
          data[offset],
          data[offset + 1],
          data[offset + 2],
          data[offset + 3],
        ]
        pixels.push(pixel)
        if (x < 3 || y < 3 || x >= info.width - 3 || y >= info.height - 3) borderPixels.push(pixel)
      }
    }

    const patchMeans = []
    const cornerStarts = [
      [0, 0],
      [Math.max(0, info.width - 4), 0],
      [0, Math.max(0, info.height - 4)],
      [Math.max(0, info.width - 4), Math.max(0, info.height - 4)],
    ]
    for (const [startX, startY] of cornerStarts) {
      const patch = []
      for (let y = startY; y < Math.min(info.height, startY + 4); y += 1) {
        for (let x = startX; x < Math.min(info.width, startX + 4); x += 1) {
          const offset = (y * info.width + x) * info.channels
          patch.push([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
        }
      }
      patchMeans.push(averagePixel(patch))
    }

    const borderMean = averagePixel(patchMeans)
    const borderStddev = stddev(borderPixels, borderMean)
    const borderCoverage = borderPixels.filter((pixel) => colorDistance(pixel, borderMean) < 22).length / Math.max(borderPixels.length, 1)
    const fullCoverage = pixels.filter((pixel) => colorDistance(pixel, borderMean) < 22).length / Math.max(pixels.length, 1)
    const transparentRatio = borderPixels.filter((pixel) => pixel[3] < 8).length / Math.max(borderPixels.length, 1)
    const cornerSpread = patchMeans.reduce((acc, corner) => acc + colorDistance(corner, borderMean), 0) / Math.max(patchMeans.length, 1)

    let score = scoreKeywordSignal(image, index)
    if (transparentRatio > 0.9) score += 18
    else if (transparentRatio > 0.55) score += 10

    if (borderCoverage > 0.97) score += 18
    else if (borderCoverage > 0.9) score += 12
    else if (borderCoverage > 0.8) score += 6
    else score -= 12

    if (fullCoverage > 0.7) score += 12
    else if (fullCoverage > 0.5) score += 7
    else if (fullCoverage > 0.35) score += 3
    else score -= 10

    if (borderStddev < 10) score += 8
    else if (borderStddev > 35) score -= 6

    if (cornerSpread < 8) score += 8
    else if (cornerSpread > 18) score -= 8

    return {
      image,
      index,
      score,
      why: `border=${borderCoverage.toFixed(2)} full=${fullCoverage.toFixed(2)} alpha=${transparentRatio.toFixed(2)} std=${borderStddev.toFixed(1)} corner=${cornerSpread.toFixed(1)}`,
    }
  } catch (error) {
    return { image, index, score: -999, why: error instanceof Error ? error.message : String(error) }
  }
}

async function runConcurrent(items, limit, worker) {
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

async function main() {
  if (!bearer) throw new Error('AGENT_BEARER_TOKEN missing')
  const { default: sharp } = await import('sharp')
  const productIds = await fetchAllProductIds()
  let checked = 0
  let changed = 0
  const unifiedThreshold = 28

  await runConcurrent(productIds, 4, async (sku) => {
    const detail = await apiGet(`/api/products/${encodeURIComponent(sku)}`)
    const images = (detail.images ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    checked += 1
    if (images.length <= 1) return

    const scored = []
    for (let index = 0; index < images.length; index += 1) {
      scored.push(await scoreImage(sharp, images[index], index))
    }

    const best = scored
      .filter((entry) => entry.score > -999)
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))[0]
    const current = scored.find((entry) => entry.index === 0) ?? null
    if (!best || !current) return
    const currentIsUnified = current.score >= unifiedThreshold
    const bestIsUnified = best.score >= unifiedThreshold
    if (currentIsUnified || !bestIsUnified || best.index === 0) return

    const reordered = [images[best.index], ...images.filter((_, index) => index !== best.index)]
    await apiPut(`/api/products/${encodeURIComponent(sku)}/images`, {
      platforms: ['xmr_bazaar'],
      images: reordered.map((image) => ({ type: 'url', url: image.url, alt: image.alt ?? undefined })),
      triggeredBy: 'agent',
    })
    changed += 1
    console.log(`[image-order] ${sku}: moved image ${best.index} -> 0 (current=${current.score} ${current.why}; best=${best.score} ${best.why})`)
  })

  console.log(`[image-order] checked=${checked} changed=${changed}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

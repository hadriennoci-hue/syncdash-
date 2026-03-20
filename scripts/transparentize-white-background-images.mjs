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
const edgePreviewRoot = path.join(process.cwd(), 'tmp', 'transparentize-white-edge-previews')
fs.mkdirSync(backupRoot, { recursive: true })
fs.mkdirSync(edgePreviewRoot, { recursive: true })

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
  return res.json()
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

function buildCheckerboard(width, height, size = 24) {
  const out = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const dark = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0
      const value = dark ? 210 : 245
      out[offset] = value
      out[offset + 1] = value
      out[offset + 2] = value
      out[offset + 3] = 255
    }
  }
  return out
}

async function analyzeAndTransform(sharp, originalBuffer) {
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
  const borderPixels = []
  const allPixels = []
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const pixel = pixelAt(x, y)
      allPixels.push(pixel)
      if (x < 3 || y < 3 || x >= info.width - 3 || y >= info.height - 3) borderPixels.push(pixel)
    }
  }

  const borderCoverage = borderPixels.filter((pixel) => colorDistance(pixel, bg) < 22).length / Math.max(borderPixels.length, 1)
  const fullCoverage = allPixels.filter((pixel) => colorDistance(pixel, bg) < 22).length / Math.max(allPixels.length, 1)
  const transparentRatio = borderPixels.filter((pixel) => pixel[3] < 8).length / Math.max(borderPixels.length, 1)
  const whiteRatio = borderPixels.filter((pixel) => pixel[0] > 235 && pixel[1] > 235 && pixel[2] > 235 && pixel[3] > 220).length / Math.max(borderPixels.length, 1)
  const backgroundIsWhite = bg[0] > 235 && bg[1] > 235 && bg[2] > 235 && bg[3] > 220

  let confidence = 'reject'
  if (transparentRatio > 0.95) confidence = 'already-transparent'
  else if (backgroundIsWhite && whiteRatio > 0.95 && borderCoverage > 0.985 && fullCoverage > 0.56) confidence = 'high'
  else if (backgroundIsWhite && whiteRatio > 0.95 && borderCoverage > 0.98 && fullCoverage > 0.4) confidence = 'low'

  if (confidence !== 'high' && confidence !== 'low') {
    return {
      confidence,
      metrics: {
        backgroundIsWhite,
        borderCoverage: +borderCoverage.toFixed(3),
        fullCoverage: +fullCoverage.toFixed(3),
        transparentRatio: +transparentRatio.toFixed(3),
        whiteRatio: +whiteRatio.toFixed(3),
      },
      transformedBuffer: null,
      previewBuffer: null,
    }
  }

  const innerThreshold = confidence === 'high' ? 18 : 14
  const featherThreshold = confidence === 'high' ? 34 : 26
  const out = Buffer.from(data)

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

  const transformedBuffer = await sharp(out, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).png().toBuffer()

  const previewBuffer = await sharp(buildCheckerboard(info.width, info.height), {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).composite([{ input: transformedBuffer }]).png().toBuffer()

  return {
    confidence,
    metrics: {
      backgroundIsWhite,
      borderCoverage: +borderCoverage.toFixed(3),
      fullCoverage: +fullCoverage.toFixed(3),
      transparentRatio: +transparentRatio.toFixed(3),
      whiteRatio: +whiteRatio.toFixed(3),
    },
    transformedBuffer,
    previewBuffer,
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
  const applied = []
  const edgeCases = []
  let checkedImages = 0

  await runConcurrent(productIds, 2, async (sku) => {
    const detail = await apiGet(`/api/products/${encodeURIComponent(sku)}`)
    const images = (detail.images ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    if (images.length === 0) return

    const nextFiles = []
    const productBackupDir = path.join(backupRoot, sku)
    const productEdgeDir = path.join(edgePreviewRoot, sku)
    const productApplied = []

    for (const [index, image] of images.entries()) {
      checkedImages += 1
      const response = await fetch(image.url)
      if (!response.ok) throw new Error(`Failed to fetch image ${image.url}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      const mimeType = response.headers.get('content-type') || 'image/jpeg'
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : 'jpg'

      const analysis = await analyzeAndTransform(sharp, buffer)

      if (analysis.confidence === 'high' && analysis.transformedBuffer) {
        fs.mkdirSync(productBackupDir, { recursive: true })
        const backupPath = path.join(productBackupDir, `${String(index).padStart(2, '0')}-original.${ext}`)
        if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, buffer)

        nextFiles.push({
          buffer: analysis.transformedBuffer,
          filename: `${sku}-${String(index).padStart(2, '0')}.png`,
          mimeType: 'image/png',
          alt: image.alt ?? '',
        })
        productApplied.push({
          index,
          originalUrl: image.url,
          backupPath,
          metrics: analysis.metrics,
        })
        continue
      }

      if (analysis.confidence === 'low' && analysis.previewBuffer) {
        fs.mkdirSync(productEdgeDir, { recursive: true })
        const beforePath = path.join(productEdgeDir, `${String(index).padStart(2, '0')}-before.png`)
        const afterPath = path.join(productEdgeDir, `${String(index).padStart(2, '0')}-after-preview.png`)
        if (!fs.existsSync(beforePath)) fs.writeFileSync(beforePath, await sharp(buffer).png().toBuffer())
        if (!fs.existsSync(afterPath)) fs.writeFileSync(afterPath, analysis.previewBuffer)
        edgeCases.push({
          sku,
          title: detail.title,
          index,
          beforePath,
          afterPath,
          metrics: analysis.metrics,
        })
      }

      nextFiles.push({
        buffer,
        filename: `${sku}-${String(index).padStart(2, '0')}.${ext}`,
        mimeType,
        alt: image.alt ?? '',
      })
    }

    if (productApplied.length === 0) return
    await uploadReplacementSet(sku, nextFiles)
    applied.push({
      sku,
      title: detail.title,
      changedImages: productApplied,
      totalImages: images.length,
    })
    console.log(`[transparentize] ${sku}: changed=${productApplied.length}/${images.length}`)
  })

  fs.writeFileSync(path.join(backupRoot, 'manifest.json'), JSON.stringify({
    appliedCount: applied.length,
    checkedImages,
    applied,
  }, null, 2))

  fs.writeFileSync(path.join(edgePreviewRoot, 'manifest.json'), JSON.stringify({
    edgeCaseCount: edgeCases.length,
    edgeCases,
  }, null, 2))

  console.log(`[transparentize] checked_images=${checkedImages} applied_products=${applied.length} edge_cases=${edgeCases.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

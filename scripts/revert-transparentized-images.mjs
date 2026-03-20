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

async function main() {
  const manifestPath = path.join(process.cwd(), 'tmp', 'transparentize-white-backup', 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error('Backup manifest not found')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  for (const product of manifest.applied ?? []) {
    const detail = await apiGet(`/api/products/${encodeURIComponent(product.sku)}`)
    const currentImages = (detail.images ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    const changedByIndex = new Map((product.changedImages ?? []).map((entry) => [entry.index, entry]))
    const files = []

    for (let index = 0; index < currentImages.length; index += 1) {
      const changed = changedByIndex.get(index)
      if (changed) {
        const backupBuffer = fs.readFileSync(changed.backupPath)
        const ext = path.extname(changed.backupPath).slice(1) || 'jpg'
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
        files.push({
          buffer: backupBuffer,
          filename: `${product.sku}-${String(index).padStart(2, '0')}-revert.${ext}`,
          mimeType,
          alt: currentImages[index]?.alt ?? '',
        })
      } else {
        const response = await fetch(currentImages[index].url)
        if (!response.ok) throw new Error(`Failed to refetch ${currentImages[index].url}`)
        const buffer = Buffer.from(await response.arrayBuffer())
        const mimeType = response.headers.get('content-type') || 'image/png'
        const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : 'jpg'
        files.push({
          buffer,
          filename: `${product.sku}-${String(index).padStart(2, '0')}-current.${ext}`,
          mimeType,
          alt: currentImages[index]?.alt ?? '',
        })
      }
    }

    await uploadReplacementSet(product.sku, files)
    console.log(`[revert-transparentize] ${product.sku}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

import { readFileSync, existsSync } from 'node:fs'

type CompetitorRow = {
  sku: string
  competitorPrice: number
  competitorUrl: string
  competitorPriceType: 'promo' | 'normal'
}

const rows: CompetitorRow[] = [
  {
    sku: 'UM.HQ0EE.304',
    competitorPrice: 189.99,
    competitorUrl: 'https://www.pccomponentes.com/acer-nitro-qg270s3-27-led-fullhd-180hz-freesync-premium',
    competitorPriceType: 'normal',
  },
  {
    sku: 'UM.QX1EE.307',
    competitorPrice: 89.99,
    competitorUrl: 'https://www.worten.pt/produtos/monitor-gaming-acer-nitro-kg241yp3-23-8-full-hd-180-hz-preto-8172450',
    competitorPriceType: 'normal',
  },
  {
    sku: 'UM.QS2EE.109',
    competitorPrice: 68.0,
    competitorUrl: 'https://www.pccomponentes.com/monitor-acer-sa242yh1bi-238-fullhd-100hz-va-tiempo-de-respuesta-4ms',
    competitorPriceType: 'promo',
  },
  {
    sku: 'UM.HX2EE.307',
    competitorPrice: 239.6,
    competitorUrl: 'https://www.mediamarkt.es/es/product/_monitor-gaming-acer-nitro-xv272uv3-27qhd-1-ms-180-hz-2-x-hdmi201-x-dp12-audio-out-negro-1569962.html',
    competitorPriceType: 'normal',
  },
]

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1)
  }
  return out
}

async function main() {
  const env = {
    ...readEnvFile('.env.local'),
    ...readEnvFile('.dev.vars'),
    ...process.env,
  }

  const baseUrl = process.argv.includes('--local')
    ? 'http://127.0.0.1:8787'
    : 'https://syncdash.hadrien-noci.workers.dev'
  const token = env.AGENT_BEARER_TOKEN || env.NEXT_PUBLIC_AGENT_BEARER_TOKEN

  if (!token) {
    throw new Error('Missing AGENT_BEARER_TOKEN or NEXT_PUBLIC_AGENT_BEARER_TOKEN')
  }

  for (const row of rows) {
    const res = await fetch(`${baseUrl}/api/products/${encodeURIComponent(row.sku)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          competitorPrice: row.competitorPrice,
          competitorUrl: row.competitorUrl,
          competitorPriceType: row.competitorPriceType,
        },
        triggeredBy: 'agent',
      }),
    })

    if (!res.ok) {
      throw new Error(`PATCH ${row.sku} failed: ${res.status} ${await res.text()}`)
    }

    console.log(`updated ${row.sku} -> EUR ${row.competitorPrice.toFixed(2)} (${row.competitorPriceType})`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

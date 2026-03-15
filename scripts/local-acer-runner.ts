/**
 * local-acer-runner.ts
 *
 * Local daemon that polls for acer-stock and acer-fill wake signals
 * and runs the corresponding scraper scripts.
 *
 * Usage:
 *   npm run runner:acer             → prod, headless
 *   npm run runner:acer:local       → local dev server
 *   npm run runner:acer:once        → run both scrapers once and exit
 *
 * Signals:
 *   acer-stock  → scrape-acer-stock.ts   (crawl categories → D1 warehouse_stock)
 *   acer-fill   → scrape-acer-images.ts  (fetch images → R2 + product_images)
 */

import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'

const args = process.argv.slice(2)
const hasFlag = (f: string) => args.includes(f)
const argValue = (prefix: string, fallback: string) =>
  args.find(a => a.startsWith(`${prefix}=`))?.slice(prefix.length + 1) ?? fallback

const ONCE         = hasFlag('--once')
const USE_LOCAL    = hasFlag('--local') || !hasFlag('--prod')
const HEADLESS     = hasFlag('--headless') || !hasFlag('--headed')
const WAKE_POLL_SEC = Number(argValue('--wake-poll-sec', '10'))

function tsNow(): string { return new Date().toISOString() }
function log(msg: string): void { console.log(`[acer-runner ${tsNow()}] ${msg}`) }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

// ---------------------------------------------------------------------------
// .dev.vars reader (same CRLF-safe logic as the other scripts)
// ---------------------------------------------------------------------------

function readDevVars(): Record<string, string> {
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.dev.vars')
    if (fs.existsSync(candidate)) {
      const vars: Record<string, string> = {}
      for (const line of fs.readFileSync(candidate, 'utf-8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.+)$/)
        if (m) vars[m[1]] = m[2].trim()
      }
      return vars
    }
    dir = path.dirname(dir)
  }
  return {}
}

function getAccessHeaders(vars: Record<string, string>): Record<string, string> {
  const id     = vars['CF_ACCESS_CLIENT_ID'] ?? vars['CLOUDFLARE_ACCESS_CLIENT_ID'] ?? ''
  const secret = vars['CF_ACCESS_CLIENT_SECRET'] ?? vars['CLOUDFLARE_ACCESS_CLIENT_SECRET'] ?? ''
  if (!id || !secret) return {}
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
}

// ---------------------------------------------------------------------------
// Wake nonce polling
// ---------------------------------------------------------------------------

async function fetchNonce(
  apiBase: string,
  token: string,
  vars: Record<string, string>,
  runner: string,
): Promise<number | null> {
  try {
    const res = await fetch(`${apiBase}/api/runner/wake?runner=${runner}`, {
      headers: { Authorization: `Bearer ${token}`, ...getAccessHeaders(vars) },
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: { wakeNonce?: number } }
    const nonce = json.data?.wakeNonce
    return typeof nonce === 'number' ? nonce : null
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Script runner
// ---------------------------------------------------------------------------

async function runScript(script: string, extraArgs: string[]): Promise<number> {
  const scriptArgs = ['tsx', script, ...extraArgs]
  log(`Spawning: npx ${scriptArgs.join(' ')}`)

  return new Promise<number>(resolve => {
    const child = spawn(
      process.platform === 'win32' ? 'cmd.exe' : 'npx',
      process.platform === 'win32' ? ['/c', 'npx', ...scriptArgs] : scriptArgs,
      { cwd: process.cwd(), stdio: 'inherit', shell: false },
    )
    child.on('error', () => resolve(1))
    child.on('exit', code => resolve(code ?? 1))
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let stopRequested = false
process.on('SIGINT',  () => { stopRequested = true })
process.on('SIGTERM', () => { stopRequested = true })

async function main(): Promise<void> {
  const vars    = readDevVars()
  const token   = process.env.AGENT_BEARER_TOKEN ?? vars['AGENT_BEARER_TOKEN'] ?? ''
  const apiBase = USE_LOCAL ? 'http://127.0.0.1:8787' : (vars['WIZHARD_URL'] ?? 'https://wizhard.store')

  if (!token) { log('❌ AGENT_BEARER_TOKEN not set in .dev.vars'); process.exit(1) }

  const commonArgs = [
    ...(USE_LOCAL ? ['--local'] : []),
    ...(HEADLESS  ? ['--headless'] : ['--headed']),
  ]

  log(`Acer runner started (api=${apiBase}, local=${USE_LOCAL}, headless=${HEADLESS}, once=${ONCE}, wakePoll=${WAKE_POLL_SEC}s)`)

  if (ONCE) {
    log('Running stock scrape...')
    await runScript('scripts/scrape-acer-stock.ts', commonArgs)
    log('Running image fill...')
    await runScript('scripts/scrape-acer-images.ts', commonArgs)
    process.exit(0)
  }

  // Initialize nonce baselines
  let stockNonce = await fetchNonce(apiBase, token, vars, 'acer-stock') ?? 0
  let fillNonce  = await fetchNonce(apiBase, token, vars, 'acer-fill')  ?? 0
  log(`Baselines — acer-stock nonce=${stockNonce}, acer-fill nonce=${fillNonce}`)

  while (!stopRequested) {
    await sleep(WAKE_POLL_SEC * 1000)
    if (stopRequested) break

    const [newStock, newFill] = await Promise.all([
      fetchNonce(apiBase, token, vars, 'acer-stock'),
      fetchNonce(apiBase, token, vars, 'acer-fill'),
    ])

    if (newStock != null && newStock > stockNonce) {
      stockNonce = newStock
      log(`acer-stock wake (nonce=${stockNonce}) — running stock scrape`)
      await runScript('scripts/scrape-acer-stock.ts', commonArgs)
    }

    if (newFill != null && newFill > fillNonce) {
      fillNonce = newFill
      log(`acer-fill wake (nonce=${fillNonce}) — running image fill`)
      await runScript('scripts/scrape-acer-images.ts', commonArgs)
    }
  }

  log('Acer runner stopped.')
}

main().catch(err => { console.error(err); process.exit(1) })

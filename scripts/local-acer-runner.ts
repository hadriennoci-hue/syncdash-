/**
 * local-acer-runner.ts
 *
 * Local daemon that polls for acer-stock and acer-fill wake signals
 * and runs the corresponding scraper scripts.
 *
 * Usage:
 *   npm run runner:acer       -> prod, headless
 *   npm run runner:acer:local -> local dev server
 *   npm run runner:acer:once  -> run both scrapers once and exit
 *
 * Signals:
 *   acer-stock -> scrape-acer-stock.ts  (crawl categories -> D1 warehouse_stock)
 *   acer-fill  -> scrape-acer-images.ts (fetch images -> R2 + product_images)
 */

import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'

const args = process.argv.slice(2)
const hasFlag = (flag: string) => args.includes(flag)
const argValue = (prefix: string, fallback: string) =>
  args.find(arg => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1) ?? fallback

const ONCE = hasFlag('--once')
const USE_LOCAL = hasFlag('--local') || !hasFlag('--prod')
const HEADLESS = hasFlag('--headless') || !hasFlag('--headed')
const WAKE_POLL_SEC = Number(argValue('--wake-poll-sec', '10'))
const runnerDir = path.join(process.cwd(), '.runner')
const statePath = path.join(runnerDir, 'acer-runner-state.json')

interface RunnerState {
  stockNonce: number
  fillNonce: number
}

function tsNow(): string {
  return new Date().toISOString()
}

function log(message: string): void {
  console.log(`[acer-runner ${tsNow()}] ${message}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readDevVars(): Record<string, string> {
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.dev.vars')
    if (fs.existsSync(candidate)) {
      const vars: Record<string, string> = {}
      for (const line of fs.readFileSync(candidate, 'utf-8').split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.+)$/)
        if (match) vars[match[1]] = match[2].trim()
      }
      return vars
    }
    dir = path.dirname(dir)
  }
  return {}
}

function getAccessHeaders(vars: Record<string, string>): Record<string, string> {
  const id = vars['CF_ACCESS_CLIENT_ID'] ?? vars['CLOUDFLARE_ACCESS_CLIENT_ID'] ?? ''
  const secret = vars['CF_ACCESS_CLIENT_SECRET'] ?? vars['CLOUDFLARE_ACCESS_CLIENT_SECRET'] ?? ''
  if (!id || !secret) return {}
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
}

function ensureRunnerDir(): void {
  fs.mkdirSync(runnerDir, { recursive: true })
}

function readRunnerState(): RunnerState {
  try {
    const raw = fs.readFileSync(statePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RunnerState>
    return {
      stockNonce: typeof parsed.stockNonce === 'number' ? parsed.stockNonce : 0,
      fillNonce: typeof parsed.fillNonce === 'number' ? parsed.fillNonce : 0,
    }
  } catch {
    return { stockNonce: 0, fillNonce: 0 }
  }
}

function writeRunnerState(state: RunnerState): void {
  ensureRunnerDir()
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
}

async function fetchNonce(
  apiBase: string,
  token: string,
  vars: Record<string, string>,
  runner: 'acer-stock' | 'acer-fill',
): Promise<number | null> {
  try {
    const res = await fetch(`${apiBase}/api/runner/wake?runner=${runner}`, {
      headers: { Authorization: `Bearer ${token}`, ...getAccessHeaders(vars) },
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: { wakeNonce?: number } }
    const nonce = json.data?.wakeNonce
    return typeof nonce === 'number' ? nonce : null
  } catch {
    return null
  }
}

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

let stopRequested = false
process.on('SIGINT', () => { stopRequested = true })
process.on('SIGTERM', () => { stopRequested = true })

async function main(): Promise<void> {
  const vars = readDevVars()
  const token = process.env.AGENT_BEARER_TOKEN ?? vars['AGENT_BEARER_TOKEN'] ?? ''
  const apiBase = USE_LOCAL ? 'http://127.0.0.1:8787' : (vars['WIZHARD_URL'] ?? 'https://wizhard.store')

  if (!token) {
    log('AGENT_BEARER_TOKEN not set in .dev.vars')
    process.exit(1)
  }
  if (!Number.isFinite(WAKE_POLL_SEC) || WAKE_POLL_SEC <= 0) {
    throw new Error(`Invalid --wake-poll-sec value: ${WAKE_POLL_SEC}`)
  }

  const commonArgs = [
    ...(USE_LOCAL ? ['--local'] : []),
    ...(HEADLESS ? ['--headless'] : ['--headed']),
  ]

  log(`Acer runner started (api=${apiBase}, local=${USE_LOCAL}, headless=${HEADLESS}, once=${ONCE}, wakePoll=${WAKE_POLL_SEC}s)`)

  if (ONCE) {
    log('Running stock scrape...')
    await runScript('scripts/scrape-acer-stock.ts', commonArgs)
    log('Running image fill...')
    await runScript('scripts/scrape-acer-images.ts', commonArgs)
    process.exit(0)
  }

  ensureRunnerDir()

  // Compare the remote wake counters to the last locally consumed counters
  // so a wake sent while the runner was offline is processed after restart.
  const persistedState = readRunnerState()
  let stockNonce = persistedState.stockNonce
  let fillNonce = persistedState.fillNonce
  const initialStockNonce = await fetchNonce(apiBase, token, vars, 'acer-stock')
  const initialFillNonce = await fetchNonce(apiBase, token, vars, 'acer-fill')

  if (initialStockNonce != null && initialStockNonce > stockNonce) {
    log(`Recovering missed acer-stock wake (stored=${stockNonce}, remote=${initialStockNonce})`)
    await runScript('scripts/scrape-acer-stock.ts', commonArgs)
    stockNonce = initialStockNonce
  } else if (initialStockNonce != null) {
    stockNonce = initialStockNonce
  }

  if (initialFillNonce != null && initialFillNonce > fillNonce) {
    log(`Recovering missed acer-fill wake (stored=${fillNonce}, remote=${initialFillNonce})`)
    await runScript('scripts/scrape-acer-images.ts', commonArgs)
    fillNonce = initialFillNonce
  } else if (initialFillNonce != null) {
    fillNonce = initialFillNonce
  }

  writeRunnerState({ stockNonce, fillNonce })
  log(`Baselines - acer-stock nonce=${stockNonce}, acer-fill nonce=${fillNonce}`)

  while (!stopRequested) {
    await sleep(WAKE_POLL_SEC * 1000)
    if (stopRequested) break

    const [newStock, newFill] = await Promise.all([
      fetchNonce(apiBase, token, vars, 'acer-stock'),
      fetchNonce(apiBase, token, vars, 'acer-fill'),
    ])

    if (newStock != null && newStock > stockNonce) {
      log(`acer-stock wake (nonce=${newStock}) - running stock scrape`)
      await runScript('scripts/scrape-acer-stock.ts', commonArgs)
      stockNonce = newStock
      writeRunnerState({ stockNonce, fillNonce })
    }

    if (newFill != null && newFill > fillNonce) {
      log(`acer-fill wake (nonce=${newFill}) - running image fill`)
      await runScript('scripts/scrape-acer-images.ts', commonArgs)
      fillNonce = newFill
      writeRunnerState({ stockNonce, fillNonce })
    }
  }

  log('Acer runner stopped.')
}

main().catch(err => {
  console.error(`[acer-runner ${tsNow()}] Fatal error:`, err)
  process.exit(1)
})

/**
 * local-browser-runner.ts
 *
 * Lightweight local daemon that periodically runs browser channel pushes.
 * Intended to run on the user's machine (Windows startup task).
 */

import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'

const args = process.argv.slice(2)

function hasFlag(flag: string): boolean {
  return args.includes(flag)
}

function argValue(prefix: string, fallback: string): string {
  const found = args.find((a) => a.startsWith(`${prefix}=`))
  return found ? found.slice(prefix.length + 1) : fallback
}

const ONCE = hasFlag('--once')
const DRY_RUN = hasFlag('--dry-run')
const USE_LOCAL = hasFlag('--local') || !hasFlag('--prod')
const HEADLESS = hasFlag('--headless') || !hasFlag('--headed')
const INTERVAL_MIN = Number(argValue('--interval-min', '5'))
const WAKE_POLL_SEC = Number(argValue('--wake-poll-sec', '10'))
const NO_WAKE = hasFlag('--no-wake')
const ALLOW_INTERVAL = hasFlag('--allow-interval')
const RUN_ON_START = hasFlag('--run-on-start')
const HEARTBEAT_MIN = Number(argValue('--heartbeat-min', '5'))
const STALE_LOCK_MIN = Number(argValue('--stale-lock-min', '360'))

const runnerDir = path.join(process.cwd(), '.runner')
const lockPath = path.join(runnerDir, 'browser-push.lock')

function tsNow(): string {
  return new Date().toISOString()
}

function log(msg: string): void {
  console.log(`[runner ${tsNow()}] ${msg}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readDevVars(): Record<string, string> {
  const candidates = [
    path.join(process.cwd(), '.dev.vars'),
    path.resolve(__dirname, '..', '.dev.vars'),
  ]
  const envPath = candidates.find((p) => fs.existsSync(p))
  if (!envPath) return {}

  const content = fs.readFileSync(envPath, 'utf-8')
  const vars: Record<string, string> = {}
  for (const raw of content.split('\n')) {
    const line = raw.replace('\uFEFF', '').trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) vars[m[1]] = m[2].trim()
  }
  return vars
}

function getAccessHeaders(vars: Record<string, string>): Record<string, string> {
  const clientId = vars['CF_ACCESS_CLIENT_ID'] ?? vars['CLOUDFLARE_ACCESS_CLIENT_ID'] ?? ''
  const clientSecret = vars['CF_ACCESS_CLIENT_SECRET'] ?? vars['CLOUDFLARE_ACCESS_CLIENT_SECRET'] ?? ''
  if (!clientId || !clientSecret) return {}
  return {
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
  }
}

function ensureRunnerDir(): void {
  fs.mkdirSync(runnerDir, { recursive: true })
}

function isLockStale(file: string): boolean {
  try {
    const stat = fs.statSync(file)
    const ageMs = Date.now() - stat.mtimeMs
    return ageMs > STALE_LOCK_MIN * 60 * 1000
  } catch {
    return false
  }
}

function acquireLock(): number | null {
  ensureRunnerDir()
  try {
    const fd = fs.openSync(lockPath, 'wx')
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: tsNow() }))
    return fd
  } catch {
    if (fs.existsSync(lockPath)) {
      try {
        const raw = fs.readFileSync(lockPath, 'utf-8')
        const lock = JSON.parse(raw) as { pid?: number }
        if (typeof lock.pid === 'number') {
          let running = true
          try { process.kill(lock.pid, 0) } catch { running = false }
          if (!running) {
            fs.unlinkSync(lockPath)
            const fd = fs.openSync(lockPath, 'wx')
            fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: tsNow(), recoveredDeadPid: true }))
            return fd
          }
        }
      } catch {}
    }

    if (fs.existsSync(lockPath) && isLockStale(lockPath)) {
      try {
        fs.unlinkSync(lockPath)
      } catch {
        return null
      }
      try {
        const fd = fs.openSync(lockPath, 'wx')
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: tsNow(), staleRecovered: true }))
        return fd
      } catch {
        return null
      }
    }
    return null
  }
}

function releaseLock(fd: number | null): void {
  if (fd == null) return
  try { fs.closeSync(fd) } catch {}
  try { fs.unlinkSync(lockPath) } catch {}
}

async function runPushOnce(): Promise<number> {
  const fd = acquireLock()
  if (fd == null) {
    log('Another push process is running. Skipping this cycle.')
    return 0
  }

  const scriptArgs = ['tsx', 'scripts/push-browser-channels.ts']
  if (USE_LOCAL) scriptArgs.push('--local')
  if (DRY_RUN) scriptArgs.push('--dry-run')
  if (HEADLESS) scriptArgs.push('--headless')

  log(`Starting push: npx ${scriptArgs.join(' ')}`)

  const code = await new Promise<number>((resolve) => {
    const command = process.platform === 'win32'
      ? 'cmd.exe'
      : 'npx'
    const commandArgs = process.platform === 'win32'
      ? ['/c', 'npx', ...scriptArgs]
      : scriptArgs
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    })
    child.on('error', () => resolve(1))
    child.on('exit', (exitCode) => resolve(exitCode ?? 1))
  })

  releaseLock(fd)

  if (code === 0) log('Push cycle completed successfully.')
  else log(`Push cycle failed with code ${code}.`)
  return code
}

async function fetchWakeNonce(apiBase: string, token: string, vars: Record<string, string>): Promise<number | null> {
  try {
    const res = await fetch(`${apiBase}/api/runner/wake?runner=browser`, {
      headers: { Authorization: `Bearer ${token}`, ...getAccessHeaders(vars) },
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: { wakeNonce?: number } }
    const nonce = json.data?.wakeNonce
    if (typeof nonce !== 'number') return null
    return nonce
  } catch {
    return null
  }
}

let stopRequested = false
process.on('SIGINT', () => { stopRequested = true })
process.on('SIGTERM', () => { stopRequested = true })

async function main(): Promise<void> {
  if (ALLOW_INTERVAL && (!Number.isFinite(INTERVAL_MIN) || INTERVAL_MIN <= 0)) {
    throw new Error(`Invalid --interval-min value: ${INTERVAL_MIN}`)
  }
  if (!Number.isFinite(WAKE_POLL_SEC) || WAKE_POLL_SEC <= 0) {
    throw new Error(`Invalid --wake-poll-sec value: ${WAKE_POLL_SEC}`)
  }
  if (!Number.isFinite(HEARTBEAT_MIN) || HEARTBEAT_MIN <= 0) {
    throw new Error(`Invalid --heartbeat-min value: ${HEARTBEAT_MIN}`)
  }

  const vars = readDevVars()
  const apiBase = USE_LOCAL
    ? 'http://127.0.0.1:8787'
    : (vars['WIZHARD_URL'] ?? '')
  const token = vars['AGENT_BEARER_TOKEN'] ?? ''
  const wakeEnabled = !NO_WAKE && !!apiBase && !!token
  const intervalEnabled = !wakeEnabled || ALLOW_INTERVAL

  log(`Runner started (interval=${intervalEnabled ? `${INTERVAL_MIN}m` : 'disabled'}, wakePoll=${WAKE_POLL_SEC}s, heartbeat=${HEARTBEAT_MIN}m, local=${USE_LOCAL}, headless=${HEADLESS}, dryRun=${DRY_RUN}, once=${ONCE}, wake=${wakeEnabled}, runOnStart=${RUN_ON_START})`)

  if (ONCE) {
    const code = await runPushOnce()
    process.exit(code)
  }

  // Do not run immediately on startup: wait for wake signal or fallback interval.
  let lastRunAt = Date.now()
  let lastWakeNonce = 0
  let wakeBaselineReady = !wakeEnabled
  if (wakeEnabled) {
    const initialNonce = await fetchWakeNonce(apiBase, token, vars)
    if (initialNonce != null) {
      lastWakeNonce = initialNonce
      wakeBaselineReady = true
    } else {
      log('Wake baseline pending: API not reachable yet, waiting for first successful nonce read.')
    }
  }
  let lastHeartbeatAt = Date.now()

  if (RUN_ON_START) {
    await runPushOnce()
    lastRunAt = Date.now()
  }

  while (!stopRequested) {
    let ran = false

    if (wakeEnabled) {
      const nonce = await fetchWakeNonce(apiBase, token, vars)
      if (nonce != null) {
        if (!wakeBaselineReady) {
          lastWakeNonce = nonce
          wakeBaselineReady = true
          log(`Wake baseline initialized at nonce=${nonce}.`)
        } else if (nonce > lastWakeNonce) {
          lastWakeNonce = nonce
          await runPushOnce()
          lastRunAt = Date.now()
          ran = true
        }
      }
    }

    if (!ran && intervalEnabled && (Date.now() - lastRunAt >= INTERVAL_MIN * 60 * 1000)) {
      await runPushOnce()
      lastRunAt = Date.now()
      ran = true
    }

    const now = Date.now()
    if (!ran && now - lastHeartbeatAt >= HEARTBEAT_MIN * 60 * 1000) {
      log('Idle heartbeat: runner alive, waiting for wake signal or next fallback cycle.')
      lastHeartbeatAt = now
    }

    if (stopRequested) break
    await sleep(ran ? 2000 : WAKE_POLL_SEC * 1000)
  }

  log('Runner stopped.')
}

main().catch((err) => {
  console.error(`[runner ${tsNow()}] Fatal error:`, err)
  process.exit(1)
})

/**
 * browser-runner-control.ts
 *
 * Local-only HTTP status service used by the Wizhard dashboard.
 * It reports whether the local Playwright browser runner is available before a
 * hosted push request is allowed to queue browser work.
 */

import * as fs from 'fs'
import * as path from 'path'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { execFile } from 'child_process'

const HOST = '127.0.0.1'
const PORT = Number(process.env.BROWSER_RUNNER_CONTROL_PORT ?? '8789')
const runnerDir = path.join(process.cwd(), '.runner')
const logPath = path.join(runnerDir, 'browser-runner.log')

const allowedOrigins = new Set([
  'https://wizhard.store',
  'https://syncdash.hadrien-noci.workers.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
])

function tsNow(): string {
  return new Date().toISOString()
}

function ensureRunnerDir(): void {
  fs.mkdirSync(runnerDir, { recursive: true })
}

function log(message: string): void {
  ensureRunnerDir()
  fs.appendFileSync(logPath, `[control ${tsNow()}] ${message}\n`)
  console.log(`[control ${tsNow()}] ${message}`)
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  data: Record<string, unknown>
): void {
  const origin = req.headers.origin
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')
  res.writeHead(status)
  res.end(JSON.stringify(data))
}

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message))
        return
      }
      resolve(stdout)
    })
  })
}

async function findRunnerPids(): Promise<number[]> {
  if (process.platform !== 'win32') {
    return []
  }

  const escapedRoot = process.cwd().replace(/'/g, "''")
  const script = `
    $root = '${escapedRoot}'
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -and
        $_.CommandLine -match 'local-browser-runner\\.ts' -and
        $_.CommandLine -like "*$root*"
      } |
      Select-Object -ExpandProperty ProcessId
  `
  const stdout = await runPowerShell(script)
  return stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

async function status(): Promise<{ running: boolean; pids: number[] }> {
  const pids = await findRunnerPids()
  return { running: pids.length > 0, pids }
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === 'OPTIONS') {
      sendJson(req, res, 204, {})
      return
    }

    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
    const origin = req.headers.origin
    if (origin && !allowedOrigins.has(origin)) {
      sendJson(req, res, 403, { ok: false, error: 'Origin not allowed' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      const runner = await status()
      sendJson(req, res, 200, { ok: true, service: 'browser-runner-control', runner })
      return
    }

    if (req.method === 'POST' && url.pathname === '/browser-runner/ensure') {
      const runner = await status()
      if (!runner.running) {
        sendJson(req, res, 409, {
          ok: false,
          error: 'Browser runner is not running',
          runner,
        })
        return
      }
      sendJson(req, res, 200, {
        ok: true,
        action: 'ready',
        runner,
      })
      return
    }

    sendJson(req, res, 404, { ok: false, error: 'Not found' })
  })().catch((err) => {
    const message = err instanceof Error ? err.message : 'Unknown error'
    log(`request failed: ${message}`)
    sendJson(req, res, 500, { ok: false, error: message })
  })
})

server.listen(PORT, HOST, () => {
  log(`Browser runner control listening at http://${HOST}:${PORT}`)
})

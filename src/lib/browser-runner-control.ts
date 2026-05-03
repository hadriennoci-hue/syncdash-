export interface BrowserRunnerHealth {
  ok?: boolean
  runner?: {
    running?: boolean
    pids?: number[]
  }
}

const BROWSER_RUNNER_HEALTH_URLS = [
  'http://127.0.0.1:8790/health',
  'http://127.0.0.1:8789/health',
] as const

async function fetchBrowserRunnerHealth(url: string): Promise<BrowserRunnerHealth> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 3000)

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json() as BrowserRunnerHealth
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function requireBrowserRunnerRunning(): Promise<BrowserRunnerHealth> {
  let lastError: Error | null = null

  try {
    for (const url of BROWSER_RUNNER_HEALTH_URLS) {
      try {
        const json = await fetchBrowserRunnerHealth(url)
        if (!json.runner?.running) {
          throw new Error('Local browser runner is not running on this laptop. Start the visible browser runner first, then push again.')
        }
        return json
      } catch (err) {
        if (err instanceof Error && err.message.includes('Local browser runner is not running')) {
          throw err
        }
        lastError = err instanceof Error ? err : new Error('Unknown browser runner check failure')
      }
    }
    throw new Error(
      'Local browser runner is not reachable on this laptop. Start the visible browser runner first, then push again.'
    )
  } catch (err) {
    if (err instanceof Error && err.message.includes('Local browser runner is not running')) {
      throw err
    }
    throw lastError ?? err
  }
}

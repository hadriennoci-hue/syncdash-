/**
 * Simple rate limiter for API calls.
 * Shopify allows 2 requests/second on REST, leaky bucket on GraphQL.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RateLimiter {
  private lastCall = 0
  private readonly minIntervalMs: number

  constructor(requestsPerSecond: number) {
    this.minIntervalMs = 1000 / requestsPerSecond
  }

  async throttle(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastCall
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed)
    }
    this.lastCall = Date.now()
  }
}

// Shared instances
export const shopifyLimiter     = new RateLimiter(2) // 2 req/s
export const woocommerceLimiter = new RateLimiter(5) // 5 req/s (conservative)
export const ebayLimiter        = new RateLimiter(4) // 4 req/s

/**
 * Semaphore — limits how many async operations run simultaneously.
 * Use for APIs with a concurrent-session cap (e.g. Firecrawl allows 5 at once).
 * Callers that exceed the limit wait in queue rather than failing.
 */
export class Semaphore {
  private slots: number
  private readonly queue: Array<() => void> = []

  constructor(private readonly max: number) {
    this.slots = max
  }

  acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--
      return Promise.resolve()
    }
    return new Promise((resolve) => this.queue.push(resolve))
  }

  release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.slots++
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}

// Max 5 concurrent Firecrawl scraping sessions (plan limit + cost control)
export const firecrawlSemaphore = new Semaphore(5)

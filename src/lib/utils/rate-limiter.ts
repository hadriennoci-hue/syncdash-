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
export const shopifyLimiter = new RateLimiter(2)     // 2 req/s
export const woocommerceLimiter = new RateLimiter(5) // 5 req/s (conservative)

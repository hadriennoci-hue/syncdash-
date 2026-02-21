export function generateId(): string {
  return globalThis.crypto.randomUUID()
}

export function generateShortId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

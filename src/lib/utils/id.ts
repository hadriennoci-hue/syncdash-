import { randomUUID } from 'crypto'

export function generateId(): string {
  return randomUUID()
}

export function generateShortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16)
}

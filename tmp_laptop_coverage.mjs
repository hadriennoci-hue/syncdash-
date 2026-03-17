// Parse LAPTOP_LABEL_MAPS from the source and show coverage per attribute key
import { readFileSync } from 'fs'
const src = readFileSync('scripts/scrape-acer-images.ts', 'utf8')

// Extract lines between LAPTOP_LABEL_MAPS and normalizeSpecValue
const start = src.indexOf('const LAPTOP_LABEL_MAPS')
const end = src.indexOf('function normalizeSpecValue', start)
const block = src.slice(start, end)

// Parse locale blocks
const locales = {}
const localeHeaderRe = /^\s{2}(\w+): \{/gm
let lm
while ((lm = localeHeaderRe.exec(block)) !== null) {
  locales[lm[1]] = {}
}

// Parse all key→value entries, associating with their locale
let currentLocale = null
for (const line of block.split('\n')) {
  const header = line.match(/^\s{2}(\w+): \{/)
  if (header) { currentLocale = header[1]; continue }
  const entry = line.match(/^\s{4}'([^']+)':\s+'([^']+)'/)
  if (entry && currentLocale) locales[currentLocale][entry[1]] = entry[2]
}

// Collect all unique target keys
const allKeys = new Set()
for (const l of Object.values(locales)) Object.values(l).forEach(v => allKeys.add(v))
const localeList = Object.keys(locales)

console.log('=== LAPTOP ATTRIBUTE KEYS (Wizhard target fields) ===')
console.log([...allKeys].sort().join(', '))
console.log('')
console.log(`=== COVERAGE (${localeList.length} locales: ${localeList.join(', ')}) ===`)
console.log('')

for (const key of [...allKeys].sort()) {
  const covered = localeList.filter(l => Object.values(locales[l]).includes(key))
  const missing = localeList.filter(l => !Object.values(locales[l]).includes(key))
  const icon = missing.length === 0 ? '✓' : (covered.length >= localeList.length * 0.7 ? '~' : '✗')
  const missingStr = missing.length ? `  ← MISSING: ${missing.join(', ')}` : ''
  console.log(` ${icon} ${key.padEnd(22)} [${covered.length}/${localeList.length}]${missingStr}`)
}

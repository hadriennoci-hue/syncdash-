import { readFileSync } from 'fs'
const d = JSON.parse(readFileSync('C:/syncdash/tmp_prod_products.json', 'utf8'))
const products = d.data || []
console.log('Total:', products.length)

const noDesc = products.filter(p => !p.description || p.description.trim() === '')
const hasDesc = products.filter(p => p.description && p.description.trim() !== '')
console.log('Has description:', hasDesc.length)
console.log('Missing description:', noDesc.length)
if (noDesc.length) noDesc.forEach(p => console.log('  NO DESC:', p.id, '|', (p.title||'').slice(0,60)))

console.log('---')

// Check attributes via metafields count
const noAttrs = products.filter(p => !p.metafields || p.metafields.length === 0)
const hasAttrs = products.filter(p => p.metafields && p.metafields.length > 0)
console.log('Has attributes:', hasAttrs.length)
console.log('Missing attributes:', noAttrs.length)
if (noAttrs.length) noAttrs.forEach(p => console.log('  NO ATTRS:', p.id, '|', (p.title||'').slice(0,60)))

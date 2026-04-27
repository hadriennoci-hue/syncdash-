const HTML_MARKER_REGEX = /<\/?[a-z][\s\S]*>/i
const HTML_ENTITY_REGEX = /&(nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i
const SHOPIFY_HTML_TAG_REGEX = /<\/?(p|br|ul|ol|li|strong|em|b|i|h[1-6]|div|span|table|thead|tbody|tr|td|th|a)\b[\s\S]*>/i

export function looksLikeHtmlDescription(value: string | null | undefined): boolean {
  const text = value?.trim()
  if (!text) return false
  return HTML_MARKER_REGEX.test(text) || HTML_ENTITY_REGEX.test(text)
}

export function isUsablePlainTextDescription(value: string | null | undefined): value is string {
  const text = value?.trim()
  return Boolean(text) && !looksLikeHtmlDescription(text)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function toShopifyDescriptionHtml(value: string | null | undefined): string {
  const text = value?.trim()
  if (!text) return ''
  if (SHOPIFY_HTML_TAG_REGEX.test(text)) return text

  return text
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.split('\n').map((line) => escapeHtml(line.trim())).join('<br>')}</p>`)
    .join('')
}

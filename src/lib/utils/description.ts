const HTML_MARKER_REGEX = /<\/?[a-z][\s\S]*>/i
const HTML_ENTITY_REGEX = /&(nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i

export function looksLikeHtmlDescription(value: string | null | undefined): boolean {
  const text = value?.trim()
  if (!text) return false
  return HTML_MARKER_REGEX.test(text) || HTML_ENTITY_REGEX.test(text)
}

export function isUsablePlainTextDescription(value: string | null | undefined): value is string {
  const text = value?.trim()
  return Boolean(text) && !looksLikeHtmlDescription(text)
}

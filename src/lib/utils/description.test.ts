import { describe, expect, it } from 'vitest'

import {
  isUsablePlainTextDescription,
  looksLikeHtmlDescription,
  toShopifyDescriptionHtml,
} from './description'

describe('description utils', () => {
  it('detects HTML-like descriptions', () => {
    expect(looksLikeHtmlDescription('<p>Hello</p>')).toBe(true)
    expect(looksLikeHtmlDescription('Hello &amp; welcome')).toBe(true)
    expect(looksLikeHtmlDescription('Plain text only')).toBe(false)
  })

  it('accepts plain text descriptions only', () => {
    expect(isUsablePlainTextDescription('Line one\nLine two')).toBe(true)
    expect(isUsablePlainTextDescription('<p>Already html</p>')).toBe(false)
    expect(isUsablePlainTextDescription('   ')).toBe(false)
  })

  it('formats plain text for Shopify HTML body', () => {
    expect(toShopifyDescriptionHtml('First line\nSecond line\n\nThird <line>')).toBe(
      '<p>First line<br>Second line</p><p>Third &lt;line&gt;</p>'
    )
  })

  it('passes existing HTML through unchanged', () => {
    expect(toShopifyDescriptionHtml('<p>Native <strong>HTML</strong></p>')).toBe(
      '<p>Native <strong>HTML</strong></p>'
    )
  })
})

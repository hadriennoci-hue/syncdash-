/**
 * TikTok Shop image compliance policy (Ireland/EU).
 *
 * Single machine-checkable source of truth for what TikTok accepts, used to rate every
 * product image pass/warn/fail before a product is eligible for the TikTok channel.
 * Mirrors the human field guide on Proton Drive
 * ("_FIELD GUIDE - TikTok Good tier specs.md" §1). Keep the two in sync; bump POLICY_VERSION
 * when the rules change so ratings can be recomputed.
 *
 * Sources: TikTok Seller University — Product Listing Policy (knowledge_id=3196690250417921)
 * and Product Detail Pages & Listing Quality Guidelines (knowledge_id=481891871868714).
 */

export const TIKTOK_IMAGE_POLICY = {
  version: 3,
  /** Hard minimum edge in px. UK/IE floor is 800 (US is 600); reject below. */
  minPx: 800,
  /** Aim for this edge in px. */
  targetPx: 1000,
  /** 1:1 square, with a small tolerance to absorb rounding. */
  aspectRatio: 1.0,
  aspectTolerance: 0.02,
  formats: ['jpg', 'jpeg', 'png'] as const,
  maxBytes: 5_000_000,
  /** Below this count the listing is capped under "Good"; hard minimum is 4. */
  minCountGood: 5,
  minCountHard: 4,
  /** Main image = position 0. */
  mainPosition: 0,
  /** Corner samples on the main image: each RGB channel must be >= this (opaque near-white). */
  mainWhiteChannelMin: 245,
  /** Near-zero saturation ⇒ greyscale (banned). */
  greyscaleSaturationMax: 0.05,
} as const

export type TiktokImageStatus = 'pass' | 'warn' | 'fail'

/** Issue codes stored in product_images.tiktok_issues (JSON array). */
export type TiktokImageIssue =
  | 'min_px'          // below the hard minimum edge
  | 'below_target'    // >= min but < target (warn)
  | 'ratio'           // not 1:1 within tolerance
  | 'format'          // not jpg/png
  | 'too_large'       // > maxBytes
  | 'greyscale'       // black & white
  | 'main_bg'         // main image corners not opaque white
  | 'main_text'       // main image may carry added text (manual review)

export const POLICY_VERSION = TIKTOK_IMAGE_POLICY.version

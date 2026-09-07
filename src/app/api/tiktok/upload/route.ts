import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { tiktokUpload } from '@/lib/functions/tiktok-api'

/** Max decoded upload size. TikTok caps certification images/files well below this. */
const MAX_BYTES = 10 * 1024 * 1024

interface UploadInput {
  path?: string
  data_base64?: string
  filename?: string
  content_type?: string
  fields?: Record<string, string>
  query?: Record<string, string>
  useShopCipher?: boolean
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * POST /api/tiktok/upload — signed multipart upload to TikTok, through Wizhard (bearer-protected).
 *
 * The generic /api/tiktok/call route can only send JSON; TikTok's upload endpoints require
 * multipart/form-data and reject JSON with 36009022. This route takes the file as base64 so
 * the caller stays a plain JSON client, and rebuilds the multipart body inside the Worker.
 *
 * Body: { path, data_base64, filename, content_type, fields?, query?, useShopCipher? }
 * e.g. { path: "/product/202309/images/upload", filename: "label.png",
 *        content_type: "image/png", fields: { use_case: "CERTIFICATION_IMAGE" } }
 */
export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  let input: UploadInput
  try {
    input = await req.json()
  } catch {
    return apiError('VALIDATION_ERROR', 'Expected JSON body', 400)
  }

  if (!input.path) return apiError('VALIDATION_ERROR', 'path is required', 400)
  if (!input.data_base64) return apiError('VALIDATION_ERROR', 'data_base64 is required', 400)
  if (!input.filename) return apiError('VALIDATION_ERROR', 'filename is required', 400)

  let bytes: Uint8Array
  try {
    bytes = decodeBase64(input.data_base64)
  } catch {
    return apiError('VALIDATION_ERROR', 'data_base64 is not valid base64', 400)
  }
  if (bytes.length === 0) return apiError('VALIDATION_ERROR', 'decoded file is empty', 400)
  if (bytes.length > MAX_BYTES) {
    return apiError('VALIDATION_ERROR', `file is ${bytes.length} bytes, max ${MAX_BYTES}`, 413)
  }

  try {
    const data = await tiktokUpload(
      input.path,
      {
        bytes,
        filename: input.filename,
        contentType: input.content_type ?? 'application/octet-stream',
      },
      input.fields ?? {},
      { query: input.query, useShopCipher: input.useShopCipher },
    )
    return apiResponse({ data, bytes: bytes.length })
  } catch (err) {
    return apiError('TIKTOK_API_ERROR', err instanceof Error ? err.message : 'Unknown error', 502)
  }
}

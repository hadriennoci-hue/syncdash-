import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiError, apiResponse } from '@/lib/utils/api-response'
import { getR2Bucket, getR2PublicUrl } from '@/lib/r2/client'
import { generateId } from '@/lib/utils/id'

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return apiError('VALIDATION_ERROR', 'Expected multipart/form-data', 400)
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return apiError('VALIDATION_ERROR', 'Missing "file" field', 400)
  }

  const ext = ALLOWED_TYPES[file.type]
  if (!ext) {
    return apiError('VALIDATION_ERROR', `Unsupported file type: ${file.type}. Allowed: jpeg, png, webp, gif`, 400)
  }

  if (file.size > MAX_SIZE_BYTES) {
    return apiError('VALIDATION_ERROR', `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB`, 400)
  }

  const folder = (formData.get('folder') as string | null) ?? 'uploads'
  const key = `${folder}/${generateId()}.${ext}`

  const bucket = getR2Bucket()
  const buffer = await file.arrayBuffer()
  await bucket.put(key, buffer, {
    httpMetadata: { contentType: file.type },
  })

  const publicUrl = `${getR2PublicUrl()}/${key}`
  return apiResponse({ url: publicUrl, key }, 201)
}

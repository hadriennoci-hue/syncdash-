import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse, apiError } from '@/lib/utils/api-response'
import { uploadProductImages } from '@/lib/functions/images'


const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const MAX_FILES = 20

export async function POST(
  req: NextRequest,
  { params }: { params: { sku: string } }
) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return apiError('VALIDATION_ERROR', 'Request must be multipart/form-data', 400)
  }

  const formData = await req.formData()
  const mode = (formData.get('mode') as string | null) ?? 'add'
  const triggeredBy = (formData.get('triggeredBy') as string | null) ?? 'human'

  if (mode !== 'replace' && mode !== 'add') {
    return apiError('VALIDATION_ERROR', 'mode must be "replace" or "add"', 400)
  }
  if (triggeredBy !== 'human' && triggeredBy !== 'agent') {
    return apiError('VALIDATION_ERROR', 'triggeredBy must be "human" or "agent"', 400)
  }

  const fileEntries = formData.getAll('files') as File[]
  if (fileEntries.length === 0) {
    return apiError('VALIDATION_ERROR', 'At least one file is required', 400)
  }
  if (fileEntries.length > MAX_FILES) {
    return apiError('VALIDATION_ERROR', `Maximum ${MAX_FILES} files per upload`, 400)
  }

  const files = []
  for (const [i, file] of fileEntries.entries()) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return apiError(
        'VALIDATION_ERROR',
        `File "${file.name}": unsupported type "${file.type}". Allowed: jpeg, png, webp, gif`,
        400
      )
    }
    if (file.size > MAX_FILE_SIZE) {
      return apiError('VALIDATION_ERROR', `File "${file.name}" exceeds the 5 MB limit`, 400)
    }
    const buffer = await file.arrayBuffer()
    const alt = (formData.get(`alt_${i}`) as string | null) ?? undefined
    files.push({ buffer, filename: file.name, mimeType: file.type, alt })
  }

  const result = await uploadProductImages(
    params.sku,
    files,
    mode as 'replace' | 'add',
    triggeredBy as 'human' | 'agent'
  )

  const status = result.errors.length > 0 && result.urls.length === 0 ? 500 : 200
  return apiResponse(result, status)
}

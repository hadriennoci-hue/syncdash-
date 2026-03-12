import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { isUsablePlainTextDescription } from '@/lib/utils/description'

interface ReadinessIssue {
  sku: string
  title: string
  reasons: string[]
}

// GET — validate which products are ready to push to Coincart2
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const allProducts = await db.query.products.findMany({
    with: {
      images: true,
      prices: true,
      categories: true,
      platformMappings: true,
    },
    where: (p, { eq }) => eq(p.status, 'active'),
  })

  const ready: string[] = []
  const notReady: ReadinessIssue[] = []

  for (const p of allProducts) {
    const reasons: string[] = []

    if (!isUsablePlainTextDescription(p.description)) reasons.push('missing_description')
    if (p.images.length < 5) reasons.push('missing_images')
    if (p.categories.length === 0) reasons.push('missing_collections')

    const priceRow = p.prices.find((pr) => pr.platform === 'coincart2')
    if (!priceRow || priceRow.price === null) reasons.push('missing_coincart2_price')

    if (reasons.length === 0) ready.push(p.id)
    else notReady.push({ sku: p.id, title: p.title, reasons })
  }

  return apiResponse({
    total: allProducts.length,
    ready: ready.length,
    notReady: notReady.length,
    issues: notReady,
  })
}

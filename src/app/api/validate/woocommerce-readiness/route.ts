import { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { apiResponse } from '@/lib/utils/api-response'
import { db } from '@/lib/db/client'
import { PLATFORMS } from '@/types/platform'


interface ReadinessIssue {
  sku:     string
  title:   string
  reasons: string[]
}

// GET — validate which products are ready to push to WooCommerce
export async function GET(req: NextRequest) {
  const auth = verifyBearer(req)
  if (auth) return auth

  const allProducts = await db.query.products.findMany({
    with: {
      images:           true,
      prices:           true,
      categories:       true,
      platformMappings: true,
    },
    where: (p, { eq }) => eq(p.status, 'active'),
  })

  const ready: string[]          = []
  const notReady: ReadinessIssue[] = []

  for (const p of allProducts) {
    const reasons: string[] = []

    if (!p.description?.trim())       reasons.push('missing_description')
    if (p.images.length < 5)          reasons.push('missing_images')
    if (p.categories.length === 0)    reasons.push('missing_categories')

    const wooPrice = p.prices.find((pr) => pr.platform === 'woocommerce')
    if (!wooPrice || wooPrice.price === null) reasons.push('missing_woocommerce_price')

    if (reasons.length === 0) {
      ready.push(p.id)
    } else {
      notReady.push({ sku: p.id, title: p.title, reasons })
    }
  }

  return apiResponse({
    total:    allProducts.length,
    ready:    ready.length,
    notReady: notReady.length,
    issues:   notReady,
  })
}

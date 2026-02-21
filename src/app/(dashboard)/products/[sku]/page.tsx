import { ProductDetailPage } from '@/components/products/ProductDetailPage'

export default function Page({ params }: { params: { sku: string } }) {
  return <ProductDetailPage sku={params.sku} />
}

# Spec - Products (/products)

## Route
`/products`

Current implementation note: this route currently redirects to `/warehouses`. Product creation/detail/edit routes are still active.

## Purpose
Master catalog table for product operations across channels.

## Primary blocks
1. **Page header** - title + "New product"
2. **Filter/search bar**
3. **Products table** with channel push states

## Data displayed (field names)
| Field | Source |
|---|---|
| `products.id` (SKU), `products.title`, `products.status`, `products.pendingReview` | `products` |
| Push state fields (`pushedWoocommerce`, `pushedShopifyKomputerzz`, `pushedShopifyTiktok`, etc.) | `products` |
| Stock totals | `warehouse_stock` aggregation |
| Price fields | `product_prices.price`, `product_prices.compareAt` |

## User actions
- Search/filter products
- Open product detail: `/products/[sku]`
- Create product: `/products/new`

## State behavior
- Loading: table skeleton
- Empty: no products/no match message
- Error: load failure + retry
- Success: paginated data table

## Responsive notes
- Desktop: full data table
- Mobile: reduced columns/card-style fallback

## Accessibility notes
- SKU links are keyboard focusable
- Status badges include text labels

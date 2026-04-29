# Graph Report - syncdash  (2026-04-28)

## Corpus Check
- 223 files · ~175,223 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1113 nodes · 2119 edges · 35 communities detected
- Extraction: 73% EXTRACTED · 27% INFERRED · 0% AMBIGUOUS · INFERRED: 566 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]

## God Nodes (most connected - your core abstractions)
1. `verifyBearer()` - 85 edges
2. `apiResponse()` - 80 edges
3. `apiError()` - 60 edges
4. `log()` - 57 edges
5. `ShopifyConnector` - 53 edges
6. `CoincartConnector` - 38 edges
7. `logOperation()` - 37 edges
8. `GET()` - 32 edges
9. `EbayConnector` - 29 edges
10. `DELETE()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `fetchVendorCounts()` --calls--> `GET()`  [INFERRED]
  src\app\api\admin\shopify-vendors\route.ts → src\app\api\warehouses\[id]\stock\route.ts
- `getShopifyToken()` --calls--> `refreshShopifyToken()`  [INFERRED]
  src\lib\functions\sales-import.ts → scripts\apply-category-mappings.mjs
- `main()` --calls--> `GET()`  [INFERRED]
  scripts\apply-category-mappings.mjs → src\app\api\warehouses\[id]\stock\route.ts
- `main()` --calls--> `log()`  [INFERRED]
  scripts\apply-category-mappings.mjs → scripts\translate-products-to-english.ts
- `main()` --calls--> `log()`  [INFERRED]
  scripts\apply-low-confidence-transparentize.mjs → scripts\translate-products-to-english.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (85): GET(), GET(), verifyBearer(), GET(), resolveRedirectUri(), GET(), POST(), GET() (+77 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (9): ShopifyConnector, ShopifyWarehouseConnector, getPushStatusUpdate(), isSkuAwarePriceConnector(), updateProductPrice(), POST(), toShopifyDescriptionHtml(), RateLimiter (+1 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (51): runDailySync(), createConnector(), createWarehouseConnector(), getWarehouseConnector(), fetchShopifyImages(), POST(), assignCategories(), getLatestHealthCheck() (+43 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (48): main(), readEnvFile(), fetchSkus(), fetchSkus(), runMigrationScript(), runSeed(), getProducts(), main() (+40 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (31): handleSubmit(), handleBrowserPushClick(), handleDiscard(), handleSave(), resolve(), clamp(), ensureBrowserRunner(), formatRevenue() (+23 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (33): verifyAdsReadBearer(), asInt(), GET(), priceChanged(), autoLinkVariantFamily(), chooseAnchor(), comparableAttrs(), extractLaptopModelKey() (+25 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (32): inferCollection(), assignInferredCollection(), backfillFromIrelandShopify(), backfillFromWarehouses(), backfillMissingAttributes(), backfillMissingImages(), buildState(), createFirecrawlBudget() (+24 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (40): apiFetch(), createBrowserSyncJob(), downloadToTemp(), failBrowserSyncJob(), finishBrowserSyncJob(), getAccessHeaders(), getChannelProducts(), getProductDetail() (+32 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (1): CoincartConnector

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (31): buildCoincartConflictSlug(), buildPushTargets(), buildVariantGroupParentSku(), checkBaseCompleteness(), checkCompleteness(), checkTargetCompleteness(), choosePrimaryProduct(), collectCoincartAttributeValues() (+23 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (31): clean(), extractOrderMarketingSignals(), fromMetaData(), getGoogleAdsAccessToken(), getGoogleTokenRecord(), googleAdsSearchStream(), importGoogleAdsData(), normalizeCustomerId() (+23 more)

### Community 11 - "Community 11"
Cohesion: 0.12
Nodes (29): assignCollection(), autoLinkVariantFamily(), detectCategory(), detectFullLocale(), detectKeyboardLayout(), detectLocale(), extractImageUrls(), extractProductData() (+21 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (28): runDailyHealthCheck(), runDailyTokenRefresh(), GET(), centsToMicros(), extractResourceId(), googleAdsApiVersion(), googleAdsHeaders(), googleAdsMutate() (+20 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (1): EbayConnector

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (17): POST(), createChannelPushJob(), decodeMessage(), encodeMessage(), finishChannelPushJob(), getLatestChannelPushJob(), markChannelPushJobError(), parseChannelPushJob() (+9 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (15): defaultFrom(), defaultTo(), GET(), dayEnd(), dayStart(), getCuratedAdsAnalytics(), isYmd(), rebuildAdsCuratedAnalytics() (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (15): cleanWhitespace(), detectCategory(), detectFullLocale(), detectKeyboardLayout(), main(), maybeDecodeMojibake(), normalizeSpecValue(), normalizeText() (+7 more)

### Community 17 - "Community 17"
Cohesion: 0.21
Nodes (16): getShortAttributeValue(), normalizeLoose(), normalizeValue(), shortenGraphics(), shortenPanelType(), shortenStorageType(), getAttributeOptions(), canonicalizeAttributeValue() (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.16
Nodes (10): closeModal(), defaultDestinationType(), fromDatetimeLocal(), initForm(), openCreate(), openEdit(), parseJsonField(), parsePositiveInt() (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.28
Nodes (14): aiTranslate(), apiFetchJson(), cleanDescription(), cleanDescriptionV2(), firecrawlExtractTranslation(), firecrawlFindLocaleUrl(), getApiHeaders(), getProduct() (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.24
Nodes (14): formatXError(), parseImageUrls(), postToX(), postTweetWithOAuth(), runSocialPublishCron(), sanitizeUrlsInContent(), uploadMediaToX(), normalizeParamString() (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.24
Nodes (13): apiFetchJson(), buildSummary(), discoverLocaleForProduct(), discoverProduct(), getAllProducts(), getApiHeaders(), getProductDetail(), main() (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.26
Nodes (10): apiGet(), apiPut(), averagePixel(), fetchAllProductIds(), headers(), main(), runConcurrent(), scoreImage() (+2 more)

### Community 23 - "Community 23"
Cohesion: 0.26
Nodes (9): apiFetchJson(), buildSummary(), classify(), getAllProducts(), getApiHeaders(), main(), mapLimit(), normalizeText() (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.29
Nodes (10): analyzeAndTransform(), apiGet(), averagePixel(), buildCheckerboard(), colorDistance(), fetchAllProductIds(), headers(), main() (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (8): fetchNonce(), getAccessHeaders(), log(), main(), readDevVars(), runScript(), sleep(), tsNow()

### Community 26 - "Community 26"
Cohesion: 0.27
Nodes (7): crawlCategory(), getAccessHeaders(), getLocaleFromUrl(), getLocalePriority(), ingestSnapshots(), log(), tsNow()

### Community 27 - "Community 27"
Cohesion: 0.4
Nodes (10): esc(), fetchJson(), fetchShopifyCollectionByHandle(), fetchWooCategories(), main(), mustGet(), parseEnvFile(), refreshShopifyToken() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.38
Nodes (8): ensureRunnerDir(), findRunnerPids(), log(), runPowerShell(), startRunner(), status(), stopRunner(), tsNow()

### Community 29 - "Community 29"
Cohesion: 0.31
Nodes (6): fetchAttributes(), fetchLaptopStockRows(), log(), main(), replaceAttributes(), tsNow()

### Community 30 - "Community 30"
Cohesion: 0.36
Nodes (7): GET(), PUT(), getProductAttributes(), normalizeKey(), normalizeNamespace(), pairKey(), setProductAttributes()

### Community 31 - "Community 31"
Cohesion: 0.43
Nodes (6): apiGet(), apiPatch(), fetchAllProductIds(), headers(), main(), runConcurrent()

### Community 32 - "Community 32"
Cohesion: 0.29
Nodes (3): return(), OrderDetailPage(), ProductDetailPage()

### Community 33 - "Community 33"
Cohesion: 0.53
Nodes (4): apiFetch(), extractModel(), log(), main()

### Community 35 - "Community 35"
Cohesion: 0.6
Nodes (3): log(), main(), tsNow()

## Knowledge Gaps
- **Thin community `Community 8`** (39 nodes): `CoincartConnector`, `.addImages()`, `.assignCategories()`, `.buildProductAttributesPayload()`, `.buildVariantWritePayload()`, `.bulkSetStock()`, `.bulkSetStockForSkus()`, `.constructor()`, `.createProduct()`, `.deleteImages()`, `.deleteProduct()`, `.extractPrimaryCollectionName()`, `.fetchPriceSnapshot()`, `.findParentProductIdBySku()`, `.findProductIdByExactSlug()`, `.findProductIdBySku()`, `.findProductIdBySlugOrTitle()`, `.findVariationIdBySku()`, `.getProduct()`, `.getProductUpdatedAt()`, `.healthCheck()`, `.importProducts()`, `.listProductsForZeroing()`, `.normalizeProduct()`, `.normalizeVariantOptionName()`, `.request()`, `.resolveVariationContext()`, `.sanitizeText()`, `.setImages()`, `.slugify()`, `.toggleStatus()`, `.toggleStatusForSku()`, `.updatePrice()`, `.updatePriceForSku()`, `.updateProduct()`, `.updateProductForSku()`, `.updateStock()`, `.updateStockForSku()`, `coincart.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (30 nodes): `EbayConnector`, `.addImages()`, `.assignCategories()`, `.authHeader()`, `.buildCategoryId()`, `.buildLocationKey()`, `.buildPolicies()`, `.bulkSetStock()`, `.constructor()`, `.createProduct()`, `.deleteImages()`, `.deleteProduct()`, `.effectivePrice()`, `.ensureAccessToken()`, `.findOfferBySku()`, `.findProductIdBySku()`, `.getInventoryItem()`, `.getOffer()`, `.getProduct()`, `.healthCheck()`, `.identityBase()`, `.importProducts()`, `.request()`, `.setImages()`, `.toggleStatus()`, `.updatePrice()`, `.updateProduct()`, `.updateStock()`, `.upsertInventoryItem()`, `ebay.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `Community 3` to `Community 5`, `Community 7`, `Community 9`, `Community 16`, `Community 21`, `Community 22`, `Community 23`, `Community 24`, `Community 27`, `Community 31`?**
  _High betweenness centrality (0.288) - this node is a cross-community bridge._
- **Why does `GET()` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 15`, `Community 16`, `Community 17`, `Community 20`, `Community 27`, `Community 30`?**
  _High betweenness centrality (0.278) - this node is a cross-community bridge._
- **Why does `verifyBearer()` connect `Community 0` to `Community 1`, `Community 2`, `Community 5`, `Community 10`, `Community 12`, `Community 14`, `Community 15`, `Community 17`, `Community 30`?**
  _High betweenness centrality (0.133) - this node is a cross-community bridge._
- **Are the 84 inferred relationships involving `verifyBearer()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`verifyBearer()` has 84 INFERRED edges - model-reasoned connections that need verification._
- **Are the 79 inferred relationships involving `apiResponse()` (e.g. with `POST()` and `POST()`) actually correct?**
  _`apiResponse()` has 79 INFERRED edges - model-reasoned connections that need verification._
- **Are the 59 inferred relationships involving `apiError()` (e.g. with `POST()` and `GET()`) actually correct?**
  _`apiError()` has 59 INFERRED edges - model-reasoned connections that need verification._
- **Are the 55 inferred relationships involving `log()` (e.g. with `printHelp()` and `listDbFiles()`) actually correct?**
  _`log()` has 55 INFERRED edges - model-reasoned connections that need verification._
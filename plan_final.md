# Plan — Dashboard de Synchronisation Produits

> Outil interne de gestion et synchronisation de catalogue produits entre WooCommerce (COINCART.STORE), Shopify (KOMPUTERZZ.COM) et Shopify TikTok Shop (compte Shopify distinct)

---

## Contexte & Objectif

Centraliser la gestion de **3 catalogues e-commerce** partageant le même inventaire, via un dashboard web hébergé sur Cloudflare Pages + D1 (SQLite).

Le site remplit deux rôles complémentaires :
1. **Interface humaine** — dashboard web pour visualiser, comparer et pousser des modifications produits
2. **Interface agent IA** — API REST accessible par Claude pour importer, analyser, détecter les incohérences et corriger le catalogue de manière conversationnelle

**Inventaire par plateforme :**

| Plateforme | Site | Nb produits | Notes |
|------------|------|-------------|-------|
| Shopify #1 | **komputerzz.com** | ~300 | ⭐ **Source initiale** — catalogue master de départ |
| WooCommerce | coincart.store | ~300 | Recevra le catalogue depuis Komputerzz |
| Shopify #2 | (compte TikTok Shop) | 30-40 | Recevra un sous-ensemble depuis Komputerzz |
| Plateforme #4 | (site tiers — futur) | TBD | Architecture prévue, à connecter plus tard |
| Plateforme #5 | (site tiers — futur) | TBD | Architecture prévue, à connecter plus tard |

> **Source de vérité — deux phases :**
> - **Phase A (one-time)** : import depuis KOMPUTERZZ.COM → SyncDash D1. Komputerzz est le point de départ.
> - **Phase B (permanent)** : SyncDash D1 est le master. Les produits sont créés directement dans SyncDash et poussés vers tous les canaux (Komputerzz, Coincart, TikTok Shop). Komputerzz devient un canal comme les autres.
>
> **SKU cohérents** entre les plateformes — clé de matching universelle.
> **Prix peuvent différer** selon la plateforme.
> **Catégories/collections** déjà synchronisées à ~99%.
> **Variante vs Single** : même SKU peut être variant sur WooCommerce et single sur Shopify — tracking dans `platform_mappings`.
> **Langue** : toutes les descriptions et données produits sont en anglais sur toutes les plateformes.
> **Extensibilité** : architecture prévue pour accueillir des plateformes 4 et 5 (sites tiers) dans le futur.

---

## Cas Particulier : Variante vs Produit Simple

Un même SKU peut exister sous deux formes selon la plateforme :

```
SKU: ABC-001

WooCommerce (COINCART)        Shopify (KOMPUTERZZ)
┌─────────────────────┐       ┌─────────────────────┐
│ Produit Parent      │       │ Produit Simple      │
│  └─ Variante Rouge  │       │   "Produit ABC"     │
│       SKU: ABC-001  │◄─────►│   SKU: ABC-001      │
│       Prix: 29€     │       │   Prix: 32€         │
└─────────────────────┘       └─────────────────────┘
```

Le champ `record_type` dans `platform_mappings` indique le type sur chaque plateforme.
Les variantes sont gérées dès la Phase 1 : import, affichage et création de produits avec variantes sont supportés d'emblée.

---

## Stack Technique

| Couche | Technologie | Rationale |
|--------|-------------|-----------|
| Frontend | Next.js 14 (App Router) | Compatible Cloudflare Pages, TypeScript |
| Backend | Cloudflare Workers (via Next.js API routes) | Natif Pages, gratuit |
| Base de données | Cloudflare D1 (SQLite) | Gratuit, suffisant pour ~300 produits |
| ORM | Drizzle ORM | Léger, compatible D1/SQLite, TypeScript natif |
| UI | Tailwind CSS + shadcn/ui | Design system propre |
| Auth | Cloudflare Access ou Basic Auth | Usage solo/petite équipe |

Pas d'IA intégrée dans le site lui-même — Claude accède au site de l'extérieur via l'API.

---

## Architecture Globale

```
┌──────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE PAGES (Dashboard)                  │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌─────────────┐  │
│  │  Tableau   │  │   Fiche    │  │  Analyse │  │  Sync Logs  │  │
│  │  Produits  │  │  Produit   │  │  Diff    │  │             │  │
│  └────────────┘  └────────────┘  └──────────┘  └─────────────┘  │
│                                                                  │
│                    ┌──────────────────┐                          │
│                    │  Cloudflare D1   │  ← Catalogue master      │
│                    └──────────────────┘                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                    API REST (routes /api/*)               │    │
│  │  Accessible par l'interface web ET par un agent IA       │    │
│  └──────────────────────────────────────────────────────────┘    │
└───────────────────────────┬──────────────────────────────────────┘
                            │ Push / Import
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
 ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
 │ WooCommerce  │  │ Shopify #1   │  │   Shopify #2     │
 │ coincart     │  │ komputerzz   │  │   TikTok Shop    │
 │ REST API     │  │ Admin API    │  │   Admin API      │
 └──────────────┘  └──────────────┘  └──────────────────┘

         ▲
         │ Appels API depuis l'extérieur
  ┌─────────────┐
  │  Claude     │  ← Agent IA externe qui utilise l'API du site
  │  (agent)    │
  └─────────────┘
```

---

## Schéma Base de Données (D1/SQLite)

### Table `products` — Catalogue master
```sql
CREATE TABLE products (
  id          TEXT PRIMARY KEY,  -- SKU (référence commune entre plateformes)
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'active',  -- active | archived
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Table `product_prices` — Prix par plateforme
```sql
CREATE TABLE product_prices (
  product_id  TEXT NOT NULL REFERENCES products(id),
  platform    TEXT NOT NULL,
  price       DECIMAL(10,2),
  compare_at  DECIMAL(10,2),  -- Prix barré
  PRIMARY KEY (product_id, platform)
);
```

### Table `product_images`
```sql
CREATE TABLE product_images (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  url         TEXT NOT NULL,
  position    INTEGER DEFAULT 0,
  alt         TEXT
);
```

### Table `product_variants`
```sql
CREATE TABLE product_variants (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  title       TEXT,       -- ex: "Rouge / XL"
  sku         TEXT,       -- SKU spécifique à la variante
  price       DECIMAL(10,2),
  stock       INTEGER DEFAULT 0,
  available   INTEGER DEFAULT 1
);
```

### Table `platform_mappings` — Correspondance IDs + variante vs simple
```sql
CREATE TABLE platform_mappings (
  product_id    TEXT NOT NULL REFERENCES products(id),
  platform      TEXT NOT NULL,
  -- 'woocommerce' | 'shopify_komputerzz' | 'shopify_tiktok' | 'platform_4' | 'platform_5' | ...
  platform_id   TEXT NOT NULL,   -- ID natif du produit sur la plateforme
  record_type   TEXT DEFAULT 'product',  -- 'product' | 'variant'
  variant_id    TEXT,            -- ID de la variante si record_type = 'variant'
  last_synced   DATETIME,
  sync_status   TEXT DEFAULT 'pending',  -- pending | synced | error
  PRIMARY KEY (product_id, platform)
);
```

### Table `categories`
```sql
CREATE TABLE categories (
  id        TEXT PRIMARY KEY,
  platform  TEXT NOT NULL,
  name      TEXT NOT NULL,
  parent_id TEXT
);

CREATE TABLE product_categories (
  product_id   TEXT NOT NULL,
  category_id  TEXT NOT NULL,
  PRIMARY KEY (product_id, category_id)
);
```

### Table `sync_log` — Historique de toutes les opérations
```sql
CREATE TABLE sync_log (
  id          TEXT PRIMARY KEY,
  product_id  TEXT,
  platform    TEXT,
  action      TEXT,
  -- 'import' | 'create' | 'update_title' | 'update_price'
  -- 'update_images' | 'toggle_status' | 'assign_categories'
  status      TEXT,  -- 'success' | 'error'
  message     TEXT,
  triggered_by TEXT DEFAULT 'human',  -- 'human' | 'agent'
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

> **Note :** `triggered_by` permet de distinguer les actions faites par l'humain depuis l'interface et celles déclenchées par un agent IA.

### Table `product_metafields` — Metafields Shopify (importés depuis Komputerzz)
```sql
CREATE TABLE product_metafields (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id),
  namespace    TEXT NOT NULL,   -- ex: 'custom', 'specifications'
  key          TEXT NOT NULL,   -- ex: 'material', 'warranty'
  value        TEXT,
  type         TEXT,            -- ex: 'single_line_text_field', 'number_integer'
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Table `tiktok_selection` — Les 30-40 produits TikTok
```sql
CREATE TABLE tiktok_selection (
  product_id  TEXT PRIMARY KEY REFERENCES products(id),
  added_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Table `analysis_reports` — Rapports d'analyse générés par l'agent
```sql
CREATE TABLE analysis_reports (
  id          TEXT PRIMARY KEY,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  summary     TEXT,   -- résumé en JSON des incohérences détectées
  status      TEXT DEFAULT 'pending'
  -- 'pending' | 'in_progress' | 'resolved'
);
```

---

## Catalogue de Fonctions (100% Déterministe)

Toutes les fonctions sont des fonctions TypeScript pures exposées via des routes API Next.js. Aucune IA dans la boucle — tu fournis les données, la fonction fait exactement ce qui est demandé. Ces fonctions sont appelables depuis l'interface web ET depuis un agent IA externe.

### Fonctions Produit

```typescript
// Créer un produit sur une ou plusieurs plateformes
createProduct(
  sku: string,
  title: string,
  description: string,           // texte brut ou HTML
  prices: PricePerPlatform,      // { woocommerce: 29, shopify_komputerzz: 32, shopify_tiktok: 27 }
  categoryIds: string[],
  images: ImageInput[],          // fichiers uploadés OU urls distantes
  platforms: Platform[]
): Promise<SyncResult[]>

// Mettre à jour les champs texte/métadonnées (sans toucher aux images ni aux prix)
updateProduct(
  sku: string,
  fields: Partial<{ title, description, status, categoryIds }>,
  platforms: Platform[]
): Promise<SyncResult[]>

// Activer ou désactiver un produit
toggleProductStatus(
  sku: string,
  status: 'active' | 'archived',
  platforms: Platform[]
): Promise<SyncResult[]>

// Supprimer un produit
deleteProduct(
  sku: string,
  platforms: Platform[]
): Promise<SyncResult[]>
```

### Fonctions Images (indépendantes)

```typescript
// Remplacer intégralement les images (supprime les anciennes, pousse les nouvelles)
setProductImages(
  sku: string,
  images: ImageInput[],
  platforms: Platform[]
): Promise<SyncResult[]>

// Ajouter des images sans toucher aux existantes
addProductImages(
  sku: string,
  images: ImageInput[],
  platforms: Platform[]
): Promise<SyncResult[]>

// Supprimer toutes les images d'un produit
deleteProductImages(
  sku: string,
  platforms: Platform[]
): Promise<SyncResult[]>
```

> **Comportement push images :** si une plateforme a déjà des images sur un produit, l'interface (et l'agent) choisit explicitement entre `setProductImages` (remplace) ou `addProductImages` (ajoute). Pas de comportement implicite.

### Fonctions Prix (indépendantes)

```typescript
updateProductPrice(
  sku: string,
  prices: PricePerPlatform,
  compareAtPrices?: PricePerPlatform
): Promise<SyncResult[]>
```

### Fonctions Import & Analyse

```typescript
// Importer le catalogue depuis une plateforme vers D1
importFromPlatform(
  platform: Platform
): Promise<{ imported: number, updated: number, errors: string[] }>

// Analyser les incohérences pour tous les produits ou un SKU donné
analyzeInconsistencies(
  sku?: string  // si omis, analyse tout le catalogue
): Promise<InconsistencyReport[]>

// Copier les images d'une plateforme vers une autre pour un SKU
copyImagesBetweenPlatforms(
  sku: string,
  sourcePlatform: Platform,
  targetPlatforms: Platform[],
  mode: 'replace' | 'add'
): Promise<SyncResult[]>
```

### Types Partagés

```typescript
type Platform = 'woocommerce' | 'shopify_komputerzz' | 'shopify_tiktok'
  | 'platform_4' | 'platform_5'  // extensible — noms à définir lors de l'ajout

type ImageInput =
  | { type: 'file'; data: Buffer; filename: string; mimeType: string }
  | { type: 'url'; url: string; alt?: string }

type PricePerPlatform = Partial<Record<Platform, number>>

type SyncResult = {
  platform: Platform
  success: boolean
  platformId?: string
  error?: string
}

type InconsistencyReport = {
  sku: string
  type: 'missing_images' | 'different_title' | 'different_description'
       | 'missing_categories' | 'different_price' | 'missing_on_platform'
  platforms: Platform[]
  details: string
  suggestedFix?: string  // ex: "Copier les images de shopify_komputerzz vers woocommerce"
}
```

---

## Routes API (accessibles par l'interface ET par l'agent IA)

```
# Import & Analyse
POST /api/import/:platform              → importFromPlatform()
GET  /api/analyze                       → analyzeInconsistencies() — tout le catalogue
GET  /api/analyze/:sku                  → analyzeInconsistencies(sku)

# Lecture
GET  /api/products                      → liste tous les produits D1
GET  /api/products/:sku                 → détail d'un produit + état sur chaque plateforme
GET  /api/sync/logs                     → historique des opérations

# Produit
POST /api/products                      → createProduct()
PATCH /api/products/:sku                → updateProduct()
PATCH /api/products/:sku/status         → toggleProductStatus()
DELETE /api/products/:sku               → deleteProduct()

# Images
PUT  /api/products/:sku/images          → setProductImages() (remplace)
POST /api/products/:sku/images          → addProductImages() (ajoute)
DELETE /api/products/:sku/images        → deleteProductImages()
POST /api/products/:sku/images/copy     → copyImagesBetweenPlatforms()

# Prix
PATCH /api/products/:sku/prices         → updateProductPrice()

# Catégories
PUT  /api/products/:sku/categories      → assignCategories()

# TikTok
GET  /api/tiktok/selection              → liste les produits TikTok
POST /api/tiktok/selection/:sku         → ajouter au catalogue TikTok
DELETE /api/tiktok/selection/:sku       → retirer du catalogue TikTok

# Mappings catégories
GET  /api/mappings                      → liste tous les mappings collection → catégorie woo
PUT  /api/mappings                      → sauvegarder les mappings (bulk)
GET  /api/validate/woocommerce-readiness → produits bloquants avant push WooCommerce
```

**Authentification API :** toutes les routes nécessitent un Bearer token statique (défini en variable d'environnement Cloudflare). L'agent IA utilise ce même token.

---

## Flux de Mise en Place (Ordre Obligatoire)

### PHASE A — Import initial depuis Komputerzz (one-time)
```
  1. POST /api/import/shopify_komputerzz
     → D1 peuplé : produits, variantes, images, collections, metafields, tax codes
     → SyncDash D1 devient le master à partir de ce moment

  2. Éditer / valider le catalogue dans le dashboard
     → Vérifier titres, descriptions, images, variantes

  3. Page /mappings : associer chaque collection Shopify à une catégorie WooCommerce
     → Mapping manuel one-time
     → Sans ce mapping, aucun push vers WooCommerce n'est possible
```

### PHASE B — Premier push vers les autres canaux
```
  4. GET /api/validate/woocommerce-readiness
     → Vérifie que chaque produit a ≥1 collection Shopify avec un mapping WooCommerce
     → Retourne la liste des produits bloquants

  5. Corriger les produits sans collection ou sans mapping

  6. Push bulk → Coincart (WooCommerce)
  7. Sélectionner les 30-40 produits TikTok → push → TikTok Shop
```

### MODE NORMAL (après Phase A+B)
```
  SyncDash est le master. Nouveau produit :
  → Créer dans SyncDash (/products/new)
  → Sélectionner les canaux cibles
  → Push vers Komputerzz + Coincart + TikTok (selon sélection)

  Modification produit :
  → Modifier dans SyncDash
  → Push vers les canaux concernés
  → sync_log enregistre l'opération
```

## Workflow Agent IA — Session de Nettoyage Catalogue

Voici comment Claude (agent externe) interagit avec le site :

```
Étape 1 — Import Komputerzz (source initiale)
  Agent → POST /api/import/shopify_komputerzz
  → D1 est peuplé avec le catalogue complet Komputerzz
    (produits, variantes, images, collections, metafields, catégories fiscales)

  Puis, quand Phase B prête :
  Agent → POST /api/import/woocommerce        ← pour comparer / détecter écarts
  Agent → POST /api/import/shopify_tiktok     ← pour comparer / détecter écarts

Étape 2 — Analyse
  Agent → GET /api/analyze
  → Reçoit la liste de toutes les incohérences détectées

Étape 3 — Dialogue avec l'humain
  Agent : "Pour le SKU ABC-001, les images sont présentes sur Shopify Komp
           mais absentes sur WooCommerce. Puis-je copier les images de
           Shopify vers WooCommerce ?"
  Humain : "Oui, go"
  Agent → POST /api/products/ABC-001/images/copy
           { source: 'shopify_komputerzz', targets: ['woocommerce'], mode: 'replace' }

Étape 4 — Confirmation & log
  Agent : "✅ Images copiées pour ABC-001 sur WooCommerce (3 photos)"
  → sync_log enregistre l'action avec triggered_by: 'agent'

Étape 5 — Boucle jusqu'à résolution de toutes les incohérences
```

---

## Fonctionnalités par Phase

### Phase 1 — Foundation & Import Komputerzz
- [ ] Setup Cloudflare Pages + D1 + Drizzle + Next.js
- [ ] Schéma D1 complet + migrations : produits, entrepôts, fournisseurs, commandes, health logs
- [ ] Architecture connecteurs extensible : `PlatformConnector` + `WarehouseConnector`
- [ ] Connecteur Shopify (réutilisable pour Komputerzz, TikTok, et stock Irlande)
- [ ] Connecteur WooCommerce
- [ ] **Import complet depuis KOMPUTERZZ.COM** — produits, variantes, images, collections, metafields, catégories fiscales
- [ ] Import catégories WooCommerce (pour préparer le mapping)
- [ ] Authentification : Cloudflare Access (UI) + Bearer token (API)

### Phase 2 — Visualisation Catalogue & Mapping
- [ ] **Tableau produits `/products`** avec tous les champs :
  - Fournisseur, SKU, nom, description O/N, statut par canal + prix + promo
  - Stock Irlande / Pologne / ACER Store
  - Catégories, collections, localisation, featured, attributs, 5 photos O/N
  - Filtres : collections, catégories, entrepôt, en promo
- [ ] **Fiche produit `/products/[sku]`** — tous les paramètres sans scroll
- [ ] **Page `/mappings`** — association collections Shopify ↔ catégories WooCommerce
- [ ] **Validation pré-push** `/validate`
- [ ] Éléments cliquables partout : SKU, canaux, entrepôts, fournisseurs, commandes
- [ ] Settings + Sync logs

### Phase 3 — Fonctions Push & Canaux de Vente
- [ ] `createProduct()`, `updateProduct()`, `toggleProductStatus()`, `deleteProduct()`
- [ ] `updateProductPrice()`, `setProductImages()`, `addProductImages()`, `copyImagesBetweenPlatforms()`
- [ ] `assignCategories()`
- [ ] **Page `/channels`** — liste des canaux de vente
- [ ] **Page `/channels/[id]`** — produits en stock / désactivés / out of stock
- [ ] Push bulk vers WooCommerce
- [ ] Upload images : drag & drop + URLs

### Phase 4 — Entrepôts, Fournisseurs & Commandes
- [ ] **Sync entrepôt Irlande** — lecture stock depuis Shopify TikTok
- [ ] **Sync ACER Store** — scraping web (Playwright ou agent Claude)
- [ ] **Page `/warehouses`** + **`/warehouses/[id]`** — stock, commandes attendues, force sync
- [ ] Override stock ACER Store (écriture manuelle) — interdit pour Irlande/Pologne
- [ ] **Page `/suppliers`** + **`/suppliers/[id]`**
- [ ] **Page `/orders`** + **`/orders/[id]`** + **`/orders/new`** — commandes fournisseurs
- [ ] Réconciliation automatique commandes vs variations de stock

### Phase 5 — Automatisation Quotidienne & Health Check
- [ ] **Cloudflare Cron Trigger** — sync journalier :
  - Lecture stocks entrepôts → D1
  - Push stock + statut vers canaux (sauf TikTok auto)
  - Réconciliation commandes
- [ ] **API Health Check journalier** — test read/write toutes les connexions, durée mesurée
- [ ] **Dashboard home page** :
  - Statut santé API (✅/❌ par connexion + durée du test)
  - Confirmation sync journalier (timestamp + résumé)
  - Logs récents
- [ ] Boutons force sync par entrepôt

### Phase 6 — Analyse, TikTok & Polishing
- [ ] `analyzeInconsistencies()` — détection automatique des écarts cross-plateformes
- [ ] Page `/analyze` — rapport d'incohérences avec actions suggérées
- [ ] Page `/tiktok` — gestion sélection TikTok (30-40 produits)
- [ ] Push en masse `/sync`
- [ ] Tests routes API + polishing UI

### Phase 7 — Extensions Futures (Optionnel)
- [ ] Entrepôt Pologne (API à définir)
- [ ] Entrepôt Espagne (TikTok Shop uniquement)
- [ ] Plateforme #4 et #5
- [ ] Webhooks stock WooCommerce/Shopify → mise à jour D1 temps réel

---

## Structure des Pages

```
/                           → Dashboard (santé API, sync journalier, logs récents)
/products                   → Tableau produits (filtres + recherche)
/products/new               → Créer un produit
/products/[sku]             → Fiche produit (tout visible sans scroll)
/products/[sku]/edit        → Éditeur produit complet

/channels                   → Liste des canaux de vente
/channels/[id]              → Produits du canal (en stock / désactivés / out of stock)

/warehouses                 → Liste des entrepôts
/warehouses/[id]            → Détail entrepôt (stock, commandes, force sync)

/orders                     → Liste des commandes fournisseurs
/orders/new                 → Créer une commande
/orders/[id]                → Détail commande

/suppliers                  → Liste des fournisseurs
/suppliers/[id]             → Détail fournisseur

/analyze                    → Rapport d'incohérences cross-plateformes
/mappings                   → Association collections Shopify ↔ catégories WooCommerce
/validate                   → Vérification pré-push WooCommerce
/sync                       → Push en masse
/sync/logs                  → Historique complet des opérations
/tiktok                     → Gestion sélection TikTok (30-40 produits)
/settings                   → Clés API, configuration
/settings/import            → Import / re-import depuis les plateformes
```

---

## Interface — Wireframes

### Vue Tableau `/products`
```
┌────────────────────────────────────────────────────────────────────────────┐
│ [Recherche...]  [Statut ▼]  [Incohérences ▼]   [+ Nouveau]  [Push masse]  │
├────────┬──────────────────┬──────────┬──────────────┬───────────────┬──────┤
│ SKU    │ Titre            │ Woo      │ Shopify Komp │ Shopify TikTok│ ⚠️   │
├────────┼──────────────────┼──────────┼──────────────┼───────────────┼──────┤
│ ABC001 │ Produit Alpha    │ ✅ synced │ ✅ synced    │ ✅ actif       │      │
│ ABC002 │ Produit Beta     │ ⚠️ diff   │ ✅ synced    │ ➖ absent      │ 2    │
│ ABC003 │ Produit Gamma    │ ✅ synced │ ✅ synced    │ ➖ absent      │      │
│ ABC004 │ Produit Delta    │ ❌ absent │ ✅ synced    │ ➖ absent      │ 1    │
└────────┴──────────────────┴──────────┴──────────────┴───────────────┴──────┘
```

### Vue Fiche `/products/[sku]`
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Retour   ABC002 — Produit Beta                             [Éditer]    │
├──────────────────────────────────────────────────────────────────────────┤
│              Master (D1)   │  WooCommerce  │ Shopify Komp │ Shopify Tik  │
│ Titre        Produit Beta  │ ✅ identique  │ ⚠️ nom diff   │ ➖ absent    │
│ Description  Lorem ipsum   │ ✅ identique  │ ⚠️ diff       │ ➖ absent    │
│ Prix         —             │ 49€           │ 52€           │ ➖ absent    │
│ Statut       Actif         │ ✅ Actif      │ ✅ Actif      │ ➖ absent    │
│ Type         —             │ 🔀 variante   │ ☑️ simple     │ ➖ absent    │
│ Images       3 photos      │ ✅ 3 photos   │ ⚠️ 2 photos   │ ➖ absent    │
├──────────────────────────────────────────────────────────────────────────┤
│ Pousser vers : [x] WooCommerce  [x] Shopify Komp  [ ] Shopify TikTok    │
│ [Push master → sélection]    [➕ Ajouter au catalogue TikTok]            │
└──────────────────────────────────────────────────────────────────────────┘
```

### Vue Analyse `/analyze`
```
┌──────────────────────────────────────────────────────────────────────────┐
│ Rapport d'incohérences — 47 problèmes détectés       [Re-analyser]       │
├──────────────────────────────────────────────────────────────────────────┤
│ 🖼️ Images manquantes (23)                                                │
│   ABC002 — Images absentes sur WooCommerce (présentes sur Shopify Komp)  │
│   [Copier depuis Shopify Komp →  WooCommerce]                            │
│                                                                          │
│ 📝 Descriptions différentes (14)                                         │
│   ABC007 — Description différente entre WooCommerce et Shopify Komp     │
│   [Voir le diff]  [Choisir la version master]                            │
│                                                                          │
│ 🏷️ Catégories manquantes (10)                                            │
│   ABC012 — Aucune catégorie sur WooCommerce                              │
│   [Assigner]                                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Sécurité

- **Web UI** : Cloudflare Access (SSO) — zéro gestion auth dans l'application
- **API** : Bearer token statique (`AGENT_BEARER_TOKEN`) — utilisé par le web UI et les agents IA externes
- Toutes les clés API et tokens dans les variables d'environnement Cloudflare (jamais en D1)
- Chaque opération loggée dans `sync_log` avec `triggered_by: 'human' | 'agent' | 'system'`
- Entrepôts Irlande et Pologne : lecture seule — toute tentative d'écriture retourne 403

---

## Contraintes & Limites Connues

| Contrainte | Détail |
|------------|--------|
| D1 SQLite | Pas de transactions complexes — suffisant pour ~300 produits + entrepôts/commandes |
| 2 comptes Shopify | 2 paires de clés API séparées, 2 instances du connecteur |
| ACER Store | Pas d'API native — scraping web requis (Playwright ou agent Claude) |
| Pologne | API stock non définie — placeholder uniquement |
| Espagne | Entrepôt futur — TikTok Shop uniquement |
| Prix par plateforme | Table `product_prices` séparée — pas de prix unique dans `products` |
| Push images | Choix explicite replace/add à chaque appel — pas de comportement implicite |
| Rate limiting | Shopify : 2 req/s / WooCommerce : max 100/page |
| Cron Workers | Pas de process long — chaque job doit finir dans les limites Workers |
| Variante vs Simple | Tracking dans `platform_mappings` — harmonisation reportée |

---

## Questions Ouvertes

- [ ] ACER Store scraping : Playwright sur Cloudflare Worker vs service de scraping dédié vs agent Claude ?
- [ ] Poland stock : quel système quand l'API sera disponible ?
- [ ] "Featured product" : metafield Shopify, tag, ou flag manuel en D1 ?
- [ ] Restriction entrepôt Espagne (TikTok only) : hardcodé dans le connecteur ou configurable via `warehouse_channel_rules` ?
- [ ] Mapping Shopify collections ↔ WooCommerce : 1→1 ou 1→N possible pour certaines collections ?

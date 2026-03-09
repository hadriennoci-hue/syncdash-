# Spec — `/settings`

**Status:** `implemented-ready`
**Frame:** `ZukOt` in `pencil-new.pen`
**Route file:** `src/app/(dashboard)/settings/page.tsx`

---

## Purpose

Settings landing page. Provides navigation to sub-sections: platform import and warehouse-channel routing rules.

---

## Page Layout

Settings cards / navigation tiles:

| Card | Route | Description |
|---|---|---|
| Import | `/settings/import` | Import products from platforms; configure import mode |
| Routing | `/settings/routing` | Warehouse-channel priority rules |

Each card shows title, description, and "Configure →" CTA.

---

## UI States

| State | Rendering |
|---|---|
| `success` | Two-column card grid (or list on mobile) |

No async data required — static navigation page.

---

## User Actions

| Action | Notes |
|---|---|
| Navigate to Import | link to `/settings/import` |
| Navigate to Routing | link to `/settings/routing` |

---

## Accessibility Notes

- Cards are `<nav>` links with `aria-label`
- Page heading `<h1>` = "Settings"

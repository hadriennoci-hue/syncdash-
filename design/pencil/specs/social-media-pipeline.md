# Spec - Social Media Pipeline (/social-media/pipeline)

## Route
`/social-media/pipeline`

## Purpose
Scheduling board for social posts by account, with validation workflow and published history.

## Primary blocks
1. **Account columns** - one column per social account
2. **Unpublished lane** - `suggested` / `validated`
3. **Published lane** - latest published posts
4. **Per-post image expansion** for additional images

## Data displayed (field names)
| Field | Source |
|---|---|
| `accounts[]` | `GET /api/social/posts` |
| `posts[]` | `GET /api/social/posts` |
| `postPk`, `accountId`, `content`, `scheduledFor`, `status`, `publishedAt` | `posts[]` |
| `imageUrl`, `images[]` | `posts[]` |

## User actions
- Validate post: `PATCH /api/social/posts/:id` (`status=validated`)
- Cancel post: `PATCH /api/social/posts/:id` (`status=canceled`)
- Revert to suggested: `PATCH /api/social/posts/:id` (`status=suggested`)
- Toggle extra image preview

## State behavior

### Loading
- "Loading pipelines..."

### Empty
- Per account: "No planned posts" / "No published posts"

### Error
- API error surfaced by query/mutation layer

### Success
- Account columns with status-colored cards

## Responsive notes
- Desktop: multi-column account grid
- Mobile: stacked account sections

## Accessibility notes
- Status actions are explicit text buttons
- Account/platform labels are text, not icon-only

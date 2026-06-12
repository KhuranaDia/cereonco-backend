---
name: Posts feeling & mediaUrls storage decision
description: Why media_urls is jsonb rather than a Postgres text[] array, and how responses normalize it.
---

The posts table stores `media_urls` as **jsonb** (`jsonb("media_urls").$type<string[]>().default([])`) and `feeling` as nullable `text`.

**Why jsonb instead of `text[]`:** the rest of the project does not use native Postgres array columns, and the production DB (Render) already had the jsonb column. Switching to `text[]` would be a destructive column-type migration on production for no functional gain — jsonb already stores the required `["url", ...]` shape.

**How to apply:**
- API exposes camelCase `mediaUrls`; DB column is snake_case `media_urls`.
- Always normalize null → `[]` in responses (route does `p.mediaUrls ?? []`), so old rows without media still return `mediaUrls: []`.
- On create, default missing `mediaUrls` to `[]`.
- `imageUrl` (single, legacy) is kept for backward compatibility and treated as deprecated — do not remove it.
- Group posts live in a SEPARATE `group_posts` table and were intentionally NOT given feeling/mediaUrls — that feature request targeted the main posts table only.

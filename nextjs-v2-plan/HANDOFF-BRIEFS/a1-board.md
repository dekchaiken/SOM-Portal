# Brief A1 — Board module

You are a Feature Engineer building the **Board module** for SOM Portal v2 (Next.js 15 rewrite). Starting cold.

## Project layout

- v1 (PHP): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/`
- v2 (Next.js): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/som-portal-v2/`

## Must read first

1. `som-portal-v2/nextjs-v2-plan/map.md` — all Phase-0 decisions
2. `som-portal-v2/nextjs-v2-plan/codebase_design.md` — patterns (RSC + Server Actions + Result<T>)
3. `som-portal-v2/nextjs-v2-plan/domain_model.md` — roles, teams, access rules
4. `api/board/index.php` + ALL files under `api/board-comments/`, `api/board-config/`, `api/stars/`
5. `som-portal-v2/src/team/scope.ts` + `src/auth/policy.ts` + `src/lib/result.ts`
6. `som-portal-v2/app/(app)/dashboard/page.tsx` + `src/ui/shadcn/*`

Peek at `data/sm/board.json` and `data/sm/board-config.json` shapes.

## Mission

Full Board module matching v1.

### Pages
- `app/(app)/board/page.tsx` — list with category tabs (board-config), filter by status, search, pin indicator, pagination 25/page
- `app/(app)/board/[id]/page.tsx` — detail + comments + star + status dropdown
- `app/(app)/board/trash/page.tsx` — soft-deleted + Restore / Permanent delete

### APIs
- Server Actions: `createPost`, `updatePost`, `softDeletePost`, `restorePost`, `pinPost`, `addComment`, `deleteComment`, `starPost`, `unstarPost`
- Route Handlers (compat): `GET /api/v1/board`, `POST`, `PATCH /[id]`, `DELETE`, `POST /[id]/restore`, `GET/POST /[id]/comments`, `GET/POST/DELETE /api/v1/stars`

### Rules
- Team-scoped: board.json, board-comments.json, stars.json
- SM-shared: board-config.json
- Feature gate: `feature:board`
- Status: open | in_progress | resolved
- Soft-delete via `deleted_at`; pin via `pinned_at`
- Match v1 field names exactly
- Zod on every write
- Suspense + Skeleton for loading

### Design
- List: table-row style with StatusChip + title + category + author + timestamp
- Detail: inline-editable title, status dropdown, body (markdown if content_html), comments at bottom
- Trash: muted, Restore + confirm permanent delete
- Mobile: cards on <lg

## Verify

Dev JWT recipe in `HANDOFF.md`. Then: create → list → comment → star → soft-delete → trash view → restore. 3-4 screenshots to `/tmp/board-*.png`.

## Report (under 200 words)

What built, v1 endpoints matched, screenshots captured, gaps. No `npm install`.

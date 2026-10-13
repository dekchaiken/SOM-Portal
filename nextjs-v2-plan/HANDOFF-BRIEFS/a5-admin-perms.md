# Brief A5 — Admin Menu Permissions + Super Team Permissions

Feature Engineer. Starting cold.

## Must read first

1. `api/menu-permissions/`, `api/nav-groups/`, `api/teams/` (all)
2. `data/menu-permissions.json`, `data/nav-groups.json`, `data/teams.json` (critical — shapes!)
3. `assets/js/super-team-permissions.js`
4. `som-portal-v2/config/nav.ts` (single source of nav items — read as "all available pages")
5. `som-portal-v2/config/permissions.ts` — `canSeePage(pageId, session)`
6. `som-portal-v2/src/auth/policy.ts`
7. Memories: `multi_team_arch`, `feedback_sm_user_menu_perms`

## Mission

### Pages
1. `app/(admin)/admin/menu-permissions/page.tsx` (ADMIN_ROLES) — role × nav item matrix, toggle visibility, writes `data/menu-permissions.json`
2. `app/(admin)/admin/nav-groups/page.tsx` (sm_admin + dev_sm) — rename/reorder groups, writes `data/nav-groups.json`
3. `app/(admin)/admin/super-team-permissions/page.tsx` (super_admin ONLY) — team × feature matrix, writes `data/teams.json`

### APIs
- `GET /api/v1/menu-permissions` (any auth, for nav rendering) / `PATCH` (ADMIN_ROLES)
- `GET/PATCH /api/v1/nav-groups` (sm_admin+dev_sm write)
- `GET /api/v1/teams` (ADMIN_ROLES) / `PATCH /[id]` (super_admin ONLY)
- `GET /api/v1/feature-flags` — per-team resolved list

### Rules
- All 3 JSON files via readSharedFile/writeSharedFile
- Super Team Permissions MUST `requireRole(SUPER_ADMIN)` — critical boundary
- Nav items from `config/nav.ts` NAV constant
- Log activity + security every save
- Guard: don't let user disable a page they themselves need (don't lock out)
- Match v1 so dual-run stays consistent

### Design
- Menu Perms: Linear-style matrix, vertical role tabs, toggles with icons, diff indicator
- Nav Groups: compact list, chevron reorder, rename on double-click
- Super Team: full-width table, sticky header, row=team, cell=toggle, legend, confirm modal
- All 3: PulseHeader + Card + consistent spacing

## Verify

super_admin JWT. Steps:
1. menu-permissions → toggle 1 item for sm_user → save → verify json → revert
2. super-team-permissions → toggle feature off for non-SM team → save → verify json → revert
3. nav-groups → rename → revert

**Cleanup**: revert ALL changes. Zero data dirty.

Screenshots `/tmp/menu-perms.png`, `/tmp/nav-groups.png`, `/tmp/super-team.png`.

## Report (under 200 words)

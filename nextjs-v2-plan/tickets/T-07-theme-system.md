# T-07 — Theme system: port 4 themes to Tailwind v4 via OKLCH

> Type: `decision` + `prototype` · HITL · Blocked by: T-02 · Owner: unclaimed

## Question

How do we port Glass / Enterprise / Console / Warm themes (× light/dark) to Tailwind v4 without the "structural overrides" tax v1 carries?

## Context

- v1 lesson (memory `feedback_theme_structural_overrides`): `.stat-card`, `.badge` had hard-coded colours; new themes needed `!important` overrides.
- v1 lesson (memory `feedback_scoped_css_vars_body_append`): popovers portalled to `<body>` lose scoped CSS variables.
- v1 lesson (memory `feedback_dark_mode_inline_html`): user-authored content with inline Tailwind pastels needs `[style*="…"]` attribute overrides.
- ui-skills `jakubkrehel/better-colors` recommends OKLCH for stable chroma across light/dark.
- GenZ overlay (`body.is-genz`) tints across whichever theme is active — must sit at the component layer, not primitive.

## Proposed

See `../design_system.md` §2 for the full token architecture.

**Deliverable for this ticket:**
1. Primitive palette in OKLCH, generated through `jakubkrehel/better-colors`.
2. Four theme files that override semantic tokens only.
3. One component tokens file (`--btn-*`, `--card-*`, `--chip-*`) bound to semantic tokens.
4. A `ThemeProvider` client that sets `data-theme` + `data-mode` + optional `data-user-genz` on `<html>`.
5. A single `/preview/theme` page showing every component in every theme × mode. The visual check target.

## Open questions

- Do we expose per-user theme + mode preferences in Settings, or default to system (`prefers-color-scheme`) with an override toggle? (v1 has both.)
- Console-theme-always-dark: enforce by refusing to render `data-mode="light"` under `data-theme="console"`? Or just visual choice?

## Resolution

**Decision:** Ship `design_system.md`'s plan as the implementation target. Theme preference is **per-user stored, system fallback**:

```ts
// resolution order each session
const theme = user.prefs?.theme ?? systemPrefersScheme() ?? 'enterprise';
const mode  = user.prefs?.mode  ?? systemPrefersScheme() ?? 'light';
```

**Deliverables (Phase 0 scaffold):**
1. `src/theme/tokens.css` — primitive OKLCH palette (light + dark), generated via ui-skill `jakubkrehel/better-colors`.
2. `src/theme/themes/{glass,enterprise,console,warm}.css` — semantic overrides.
3. `src/theme/components.css` — component tokens (`--btn-*`, `--card-*`, `--chip-*`).
4. `src/theme/ThemeProvider.tsx` — client provider, sets `data-theme`, `data-mode`, `data-user-genz` on `<html>`.
5. `/preview/theme` route — all components × 4 themes × 2 modes × GenZ overlay. The visual check target.
6. `GET /api/v1/user-prefs` + `PATCH` for the per-user record (stored in team-scoped `user-prefs.json`).

**Console-theme-always-dark:** enforced in `ThemeProvider` — if `data-theme=console` and `data-mode=light`, the provider overrides to dark and logs a warning. Prevents a broken state at the UI layer.

**GenZ overlay:** sits at the **component** token layer (overrides `--btn-primary-bg`, `--card-accent-fg`, nothing more) so neutral surfaces stay neutral.

**Why per-user:** v1 behaviour; losing it would be a visible regression. Server-side storage also lets us sync across devices (mobile pass is a secondary goal in PRD §2).

**Follow-ups:**
- Theme switcher UI lives in `settings.html` → `/v2/settings` page.
- Ticket for an admin "team default theme" override exists if a team wants a mandated look — defer until requested.

**Owner:** Chief Architect
**Date:** 2026-10-11

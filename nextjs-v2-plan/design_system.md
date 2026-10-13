# Design System — SOM Portal v2

> Status: **draft**. The look-and-feel plan. The implementation references live on [ui-skills.com](https://www.ui-skills.com); fetch them with `mcp__ui-skills__get_skill` as you build.

## 1. Reference skills

Primary sources consulted (via `mcp__ui-skills__list_skills` + `get_skill`):

| Skill | What we take from it |
|---|---|
| `dammyjay93/interface-design` | Dashboard + admin-panel craft rules; density, hierarchy, consistency. |
| `nextlevelbuilder/design-system` | Three-layer token architecture (primitive → semantic → component). |
| `nextlevelbuilder/ui-styling` | shadcn/ui + Radix + Tailwind usage patterns, dark-mode discipline. |
| `jakubkrehel/better-colors` | OKLCH color space, palette generation, gamut-safe dark mode. |
| `vercel/next-cache-components` | Instant-navigation route patterns under Cache Components. |
| `iart-ai/page-transition-animation` | App Router page transitions that don't fight RSC. |

**Rule:** before you code a pattern, fetch the relevant skill. Before you make a palette, call `jakubkrehel/better-colors`. Before you lay out an admin panel, call `dammyjay93/interface-design`.

## 2. Themes (ties to T-07)

v1 ships 4 themes × light/dark. v2 keeps the names so users feel at home:

| Theme | Vibe | Dark variant |
|---|---|---|
| Glass | Translucent, soft blurs | Yes |
| Enterprise | Clean, neutral, high density | Yes |
| Console | Terminal / monospace flavour | **Always dark** |
| Warm | Earthy tones, soft contrast | Yes |

GenZ is **not a theme** — it's an overlay (`body[data-user-genz]`) that tints the active theme purple/pink. Keeps the theme matrix a 4×2.

### Token layers (per `nextlevelbuilder/design-system`)

```css
/* primitive — raw palette, OKLCH */
--p-neutral-50:  oklch(0.98 0.005 240);
--p-neutral-900: oklch(0.22 0.012 240);
--p-brand-500:   oklch(0.68 0.17 250);
--p-success-500: oklch(0.72 0.17 155);
--p-warning-500: oklch(0.78 0.15  80);
--p-danger-500:  oklch(0.65 0.21  25);

/* semantic — role, theme-swappable */
--bg-page:        var(--p-neutral-50);
--bg-card:        var(--p-neutral-100);
--text:           var(--p-neutral-900);
--text-muted:     var(--p-neutral-600);
--border:         var(--p-neutral-200);
--accent:         var(--p-brand-500);
--state-success:  var(--p-success-500);
--state-warning:  var(--p-warning-500);
--state-danger:   var(--p-danger-500);

/* component — tightest scope */
--btn-primary-bg:        var(--accent);
--btn-primary-fg:        var(--p-neutral-50);
--stat-card-bg:          var(--bg-card);
--stat-card-border:      var(--border);
```

Themes override at the semantic layer, never the primitive layer. GenZ overlay overrides at the **component** layer so brand buttons/headers tint but neutral surfaces stay neutral.

**Lesson from v1** (see `feedback_theme_structural_overrides` memory): `.stat-card` and `.badge` had hard-coded colours in v1. In v2, every surface pulls from a `--component-*` token so a new theme is a single CSS file.

**Lesson** (see `feedback_scoped_css_vars_body_append`): popovers portalled to `<body>` must use the semantic `:root` tokens, not scoped tokens from the parent panel. In v2, all portals (shadcn `DialogPortal`, `PopoverPortal`) read `:root` by construction.

## 3. Typography

| Role | Font | Size | Weight |
|---|---|---|---|
| Display | `Inter`, system fallback | 32px / 2rem | 600 |
| H1 | Inter | 24px | 600 |
| H2 | Inter | 20px | 600 |
| H3 | Inter | 16px | 600 |
| Body | Inter | 14px | 400 |
| Micro | Inter | 12px | 400 |
| Mono | `JetBrains Mono` | 13px | 400 |

Line-height: 1.5 body, 1.3 headings. Letter-spacing untouched (Inter is well-tuned).

## 4. Spacing & grid

Spacing scale: 2, 4, 8, 12, 16, 20, 24, 32, 40, 56, 72 (px). Tailwind `spacing` config maps 1:1.

**Grid rule** (per `feedback_frontend_dos_donts`): `grid-template-columns` on wide dashboard grids must use `minmax(0, 1fr)` so overflowing cards don't break layout. shadcn `DataTable` wraps in a `min-w-0` by default.

Container widths:
- `max-w-screen-xl` (1280px) for single-column pages
- `max-w-screen-2xl` (1536px) for the Service Performance 3-column Command Center

## 5. Elevation & borders

Flat first; shadow only where interaction demands (menus, popovers, modals).

```css
--elev-0: none;
--elev-1: 0 1px 2px oklch(0 0 0 / 0.04);
--elev-2: 0 4px 12px oklch(0 0 0 / 0.08);
--elev-3: 0 10px 30px oklch(0 0 0 / 0.12);
```

Border radius: 6 (default), 10 (cards), 999 (pills). No sharp corners anywhere except Console theme (0 radius throughout).

## 6. Icon system

`lucide-react` imported where used (tree-shaken). Shared wrapper for size/colour consistency:

```tsx
export function Icon({ name, size = 16, className }: IconProps) {
  const Component = icons[name];
  return <Component size={size} className={cn('text-current', className)} aria-hidden />;
}
```

- Never render emoji in HTML. Enforced in a lint rule.
- Icon names map 1:1 to v1's 147-icon set; where a v1 name doesn't exist in Lucide, we add a thin SVG under `src/icons/custom/`.

## 7. Component library

shadcn/ui components we need in Phase 1:
- Button, Input, Textarea, Select, Combobox, Checkbox, Switch
- Dialog, Sheet, Popover, Tooltip, DropdownMenu, ContextMenu
- Tabs, Accordion, Collapsible
- Table (via DataTable recipe), Pagination
- Toast (Sonner), Alert
- Card, Badge, Avatar, Separator
- Command (⌘K palette for search module)
- Skeleton (ties to v1's skeleton library)

Non-shadcn additions:
- `KpiCard` — Service Performance style
- `StatusChip` — board statuses, MA status, Jenkins build status
- `PulseHeader` — the page banner from service-performance.html (see `feedback_service_perf_ui_style`)
- `KnowledgeGraph` — GenZ Notes force-directed graph port

Each component gets a token binding in `src/theme/components.css`.

## 8. Layout reference patterns

### 8.1 Three-column Command Center (service-performance pattern)

```
┌──────────────────────────────────────────────────────────┐
│  PulseHeader (title, filters, range picker)              │
├────────────┬─────────────────────────────┬───────────────┤
│  Sidebar   │  Primary chart grid         │  Side panel   │
│  (search,  │  (CPU / MEM / pod replicas) │  (alerts,     │
│  pinned,   │                             │  details)     │
│  tabs)     │                             │               │
└────────────┴─────────────────────────────┴───────────────┘
```

- Columns `[260px, minmax(0, 1fr), 320px]`
- Sidebar collapses to overlay on `< lg`
- Right panel hides on `< xl`, becomes a tab

Reuse for: Restart Analyzer, Log Explorer, future dashboards.

### 8.2 List + detail (board, jira templates, users)

```
┌──────────────────────────────┐
│  Toolbar (search, filters,   │
│  New button)                 │
├────────────────┬─────────────┤
│  List (table   │  Detail or  │
│  or cards)     │  empty      │
│                │  state      │
└────────────────┴─────────────┘
```

- Default split `[1fr, 420px]`; detail hidden until a row is selected on mobile.

### 8.3 Form layout (settings, admin forms)

- Single column `max-w-2xl`
- Section headers at left, fields at right on `≥ md`
- Save bar sticky at bottom with "Discard" + "Save" + change counter

## 9. Loading, empty, error

Loading: shadcn `Skeleton` composed to match the layout. Per `project_global_loading_plan`, the shipped skeleton library of 10 patterns ports 1:1.

Empty: centred illustration (Lucide icon in a muted circle) + headline + one primary action. No "No data" with nothing to do.

Error: inline `Alert destructive` with a retry button; never a dead page. 500s show a developer-friendly stack trace behind a toggle in dev only.

## 10. Motion

- Default transitions `150ms ease-out`.
- `prefers-reduced-motion` disables all non-essential motion.
- Route transitions via `iart-ai/page-transition-animation` App Router patterns — View Transitions API first, Framer Motion for anything the browser can't natively tween.
- No parallax, no scroll-jacking.

## 11. Accessibility

- Target WCAG 2.1 AA.
- All interactive elements focus-visible (shadcn gives this for free).
- Colour contrast checked with `jakubkrehel/better-colors` palette tool before a theme ships.
- Keyboard: arrow-key nav in tables, `/` focuses global search, `⌘K` opens the command palette.

## 12. Dark mode

Every surface is theme-tokenised. The dark variant of each theme is NOT a filter — it's its own palette generated through OKLCH to keep chroma stable at low luminance.

**Lesson** (per `feedback_dark_mode_inline_html` memory): lesson/KB `content_html` in v1 carried hard-coded Tailwind pastels. In v2, any user-authored HTML runs through a sanitiser that strips inline `style="color:…"` and `class="text-…"` in favour of semantic data attributes a theme can hook.

## 13. Branding

- Logo: current SOM mark, re-exported as SVG with `currentColor` paint.
- Favicon + PWA icons regenerated for `apple-web-app` support (see ui-skills `joe-bell/apple-web-app`).
- Product name stays "SOM Portal". No marketing rebrand in v2.

## 14. Deliverables for the design-system ticket (T-07)

1. `src/theme/tokens.css` — primitive layer, light + dark primitives.
2. `src/theme/themes/{glass,enterprise,console,warm}.css` — semantic overrides.
3. `src/theme/components.css` — component bindings.
4. `src/theme/ThemeProvider.tsx` — client provider that sets `data-theme` + `data-mode` on `<html>`.
5. Figma library stub (optional, if we end up collaborating with a designer).

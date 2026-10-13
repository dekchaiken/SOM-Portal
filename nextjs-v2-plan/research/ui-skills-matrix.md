# ui-skills Matrix

Source registry: [ui-skills.com](https://www.ui-skills.com/skills/registry.json). Audited for the SOM-Portal v2 rewrite (Next.js 15 + Tailwind v4 + shadcn/ui) on 2026-10-11.

---

## 1. How to use this

**Rule:** Before writing a v2 UI concern, call the matching ui-skill with `mcp__ui-skills__get_skill` and apply its concrete rules. The registry carries battle-tested, numbered defaults (durations, OKLCH ladders, radius math, token taxonomies) — do not re-derive them in prose or memory. This file is the concern → skill map.

**Policy:**
- Must-call skills are non-negotiable before implementing or reviewing that concern.
- Secondary skills are consulted when the primary flags something (motion polish after animating, accessibility audit after shipping a form).
- When no skill covers a concern (section 4), proceed from first principles and record the gap.

---

## 2. Skill catalog (deduped)

| Slug | Takeaway (one line) | Category | URL |
|---|---|---|---|
| `dammyjay93/interface-design` | Craft-first dashboard/admin playbook: intent → domain exploration → hierarchy → tokens → polish; "if another AI would produce the same, you failed." | component / layout | https://www.ui-skills.com/skills/dammyjay93/interface-design/llms.txt |
| `shadcn-ui/shadcn` | Project-aware shadcn/ui workflow — CLI (`info`/`search`/`add`/`docs`), composition rules (FieldGroup, size-*, gap, data-icon, no manual z-index). | component | https://www.ui-skills.com/skills/shadcn-ui/shadcn/llms.txt |
| `jakubkrehel/better-colors` | OKLCH palette + semantic-token audit; one role per token, hue stability, measured contrast. | color / token | https://www.ui-skills.com/skills/jakubkrehel/better-colors/llms.txt |
| `jakubkrehel/oklch-skill` | Concrete OKLCH thresholds (L > 0.6 light; APCA ≥ 60; adjust L not C for contrast); Tailwind v4 `@theme` conversion. | color | https://www.ui-skills.com/skills/jakubkrehel/oklch-skill/llms.txt |
| `mengto/tailwindcss` | Utility-first patterns + content-path/safelist gotchas; prefer components over `@apply`. | tooling | https://www.ui-skills.com/skills/mengto/tailwindcss/llms.txt |
| `flornkm/prefer-container-queries` | Default to `@container` + `@md:` variants; viewport breakpoints only for page-level chrome. | layout | https://www.ui-skills.com/skills/flornkm/prefer-container-queries/llms.txt |
| `millionco/tailwind-token-consolidation` | Dedupe `@theme inline` tokens with usage-live analysis, canonical-source overrides; expect ~50-60% reduction, not 70%. | token / tooling | https://www.ui-skills.com/skills/millionco/tailwind-token-consolidation/llms.txt |
| `emilkowalski/ask-sonner` | Mount one `<Toaster>` at root; `toast.promise` for async; headless (`toast.custom`) for brand toasts; `theme="system"`. | component | https://www.ui-skills.com/skills/emilkowalski/ask-sonner/llms.txt |
| `iart-ai/page-transition-animation` | App Router: `template.tsx` + pathname-keyed `AnimatePresence mode="wait"` + **FrozenRouter**; or `next-view-transitions`. | motion | https://www.ui-skills.com/skills/iart-ai/page-transition-animation/llms.txt |
| `iart-ai/micro-interaction` | 100–250ms, transform+opacity only; `whileTap scale 0.96`; `AnimatePresence` + `mode="popLayout"` for toasts/lists. | motion | https://www.ui-skills.com/skills/iart-ai/micro-interaction/llms.txt |
| `iart-ai/accessible-animation` | Tiered reduced-motion (Tier 1 remove / 2 soften / 3 keep); gate GSAP/Framer/Lenis via `matchMedia`; `0.01ms`, not `0s`. | motion / a11y | https://www.ui-skills.com/skills/iart-ai/accessible-animation/llms.txt |
| `emilkowalski/animate` | Decision-ordered motion skill: gate (100+/day → no motion), purpose, cheapest tool, properties, curves (`cubic-bezier(0.23,1,0.32,1)`), <300ms. | motion | https://www.ui-skills.com/skills/emilkowalski/animate/llms.txt |
| `raphaelsalaja/mastering-animate-presence` | Rule-set for `AnimatePresence` (wrapper, exit prop, stable keys, `mode="popLayout"`, nested `propagate`). | motion | https://www.ui-skills.com/skills/raphaelsalaja/mastering-animate-presence/llms.txt |
| `jakubantalik/transitions-dev` | 12 drop-in CSS recipes (card resize, dropdown, modal, panel, page side-by-side, text/icon swap, success check, error shake). | motion | https://www.ui-skills.com/skills/jakubantalik/transitions-dev/llms.txt |
| `jakubantalik/transitions-polish` | 5-dimension motion-token audit (duration/distance/scale/blur/easing) with open-close asymmetry + stagger rules. | motion | https://www.ui-skills.com/skills/jakubantalik/transitions-polish/llms.txt |
| `larashero3-dotcom/lieflat-charts` | Chart selection discipline — pick by data shape (比较/占比/时间/关系), prefer SVG/编辑型 templates over dashboard defaults. | chart | https://www.ui-skills.com/skills/larashero3-dotcom/lieflat-charts/llms.txt |
| `ibelick/fixing-accessibility` | WCAG triage: accessible names, keyboard, focus+dialogs, forms (`aria-describedby` + `aria-invalid`); native > ARIA. | a11y | https://www.ui-skills.com/skills/ibelick/fixing-accessibility/llms.txt |
| `jakubkrehel/better-accessibility` | WCAG 2.2 review: focus-visible 3:1, roving tabindex, `<dialog>`+`inert`, 24×24 min target, `prefers-reduced-motion` tiering. | a11y | https://www.ui-skills.com/skills/jakubkrehel/better-accessibility/llms.txt |
| `wshobson/wcag-audit-patterns` | WCAG 2.2 audit framework (POUR, severity tiers, automated+manual mix). | a11y | https://www.ui-skills.com/skills/wshobson/wcag-audit-patterns/llms.txt |
| `emilkowalski/mobile-native` | Mobile tells: `(hover: hover)` gate, kill tap highlight, 16px input zoom fix, `100dvh`/`100svh`, safe-area insets, `touch-action`. | mobile | https://www.ui-skills.com/skills/emilkowalski/mobile-native/llms.txt |
| `joe-bell/apple-web-app` | iOS/iPadOS Home Screen & macOS Dock web app: safe areas, status bar, manifest, icons, splash. | pwa / mobile | https://www.ui-skills.com/skills/joe-bell/apple-web-app/llms.txt |
| `vercel-labs/web-design-guidelines` | Vercel's Web Interface Guidelines reviewer (design/a11y/UX file-based audit). | review | https://www.ui-skills.com/skills/vercel-labs/web-design-guidelines/llms.txt |
| `vercel-labs/react-best-practices` | 70 React/Next.js perf rules — eliminate waterfalls, barrel-free imports, `next/dynamic`, Suspense, React.cache. | perf / arch | https://www.ui-skills.com/skills/vercel-labs/react-best-practices/llms.txt |
| `iart-ai/glassmorphism` | Four ingredients for glass (frost, translucency, edge, depth); perf caveats + reduced-transparency fallback. | motion / color | https://www.ui-skills.com/skills/iart-ai/glassmorphism/llms.txt |
| `emilkowalski/pick-ui-library` | Opinionated picks: cmdk (⌘K), Sonner, base-ui, Motion, NumberFlow, dnd kit, Virtuoso, zustand, cva, next-themes. | component / tooling | https://www.ui-skills.com/skills/emilkowalski/pick-ui-library/llms.txt |
| `emilkowalski/apple-design` | Fluid-interface playbook: spring interruptibility, velocity handoff, momentum projection, `backdrop-filter` depth. | motion | https://www.ui-skills.com/skills/emilkowalski/apple-design/llms.txt |
| `s0xdk/refactoring-ui` | Fixed scales (spacing, type 12→72, 9-shade color, 5-shadow elevation); hierarchy via weight+color, not size. | token / layout | https://www.ui-skills.com/skills/s0xdk/refactoring-ui/llms.txt |
| `jakubkrehel/better-layout` | Groups by space > lines; logical properties; `minmax(0,1fr)` + `min-width: 0`; `100dvh`; sticky `scroll-padding`. | layout | https://www.ui-skills.com/skills/jakubkrehel/better-layout/llms.txt |
| `jakubkrehel/better-ui` | Polish values: concentric radius, `scale(0.96)` press 150ms, shadows over borders, 100ms stagger, `AnimatePresence initial={false}`. | component / motion | https://www.ui-skills.com/skills/jakubkrehel/better-ui/llms.txt |
| `ibelick/baseline-ui` | Fast deslop pass: Tailwind defaults, `h-dvh`, `size-*`, no `transition-all`, no gradients unless asked. | review | https://www.ui-skills.com/skills/ibelick/baseline-ui/llms.txt |
| `ibelick/fixing-motion-performance` | Compositor-only motion; batch reads; prefer Scroll/View Timelines; no scroll-event-driven animation. | motion / perf | https://www.ui-skills.com/skills/ibelick/fixing-motion-performance/llms.txt |

---

## 3. Matrix — concern × skills

Rows are ordered roughly by build sequence. "Must-call" means **call the skill before coding**, not merely before shipping.

| Concern | Primary skills | Secondary skills | Must-call? |
|---|---|---|---|
| **Theme + token system** (4 themes × light/dark + GenZ overlay) | `jakubkrehel/better-colors`, `millionco/tailwind-token-consolidation`, `s0xdk/refactoring-ui` | `shadcn-ui/shadcn` (`@theme inline`, semantic tokens), `jakubkrehel/better-ui` (radius/shadow tiers) | **Yes** |
| **Palette generation (OKLCH)** | `jakubkrehel/oklch-skill`, `jakubkrehel/better-colors` | `s0xdk/refactoring-ui` (9-shade ramps + ordering), `wshobson/wcag-audit-patterns` (contrast tiers) | **Yes** |
| **Dashboard layout (3-col Command Center)** — `service-performance`, `dashboard`, `ma-status` | `dammyjay93/interface-design` (hierarchy, focal element), `jakubkrehel/better-layout` | `flornkm/prefer-container-queries` (cards in sidebar/modal), `s0xdk/refactoring-ui` (spacing scale) | **Yes** |
| **Admin forms** — `system-settings`, `menu-permissions`, `jira-config`, `incident-launcher-config` | `shadcn-ui/shadcn` (FieldGroup/Field/InputGroup/ToggleGroup rules), `ibelick/fixing-accessibility` (aria-describedby, aria-invalid) | `jakubkrehel/better-writing` (labels/errors — out of scope) | **Yes** |
| **Data tables** (sortable, filterable, paginated) — `users`, `batch-monitor`, `log-explorer`, `audit-log` | `shadcn-ui/shadcn` (`Table`, `Pagination`, `Combobox`), `jakubkrehel/better-layout` (`minmax(0,1fr)` + `min-width: 0`) | `emilkowalski/pick-ui-library` (Virtuoso for 1000+ rows), `vercel-labs/react-best-practices` (`rerender-*`, `rendering-content-visibility`) | **Yes** |
| **List + detail panes** — board, templates, users, log-explorer | `jakubantalik/transitions-dev` (page side-by-side), `jakubkrehel/better-layout` | `dammyjay93/interface-design` (one focal element per view) | Yes |
| **Dialog / Sheet / Popover** | `shadcn-ui/shadcn` (`Dialog`+`DialogTitle`, Sheet, Popover with `asChild`/`render`), `ibelick/fixing-accessibility` (focus trap, Escape) | `jakubantalik/transitions-dev` (modal / dropdown recipes), `emilkowalski/animate` (`var(--transform-origin)` on triggers) | **Yes** |
| **Toast / Alert** | `emilkowalski/ask-sonner`, `shadcn-ui/shadcn` (`Alert` vs `toast()`) | `raphaelsalaja/mastering-animate-presence` (`mode="popLayout"`) | **Yes** |
| **Command palette (⌘K)** — portal-wide search | `emilkowalski/pick-ui-library` (cmdk), `shadcn-ui/shadcn` (`Command` inside `Dialog`) | `emilkowalski/animate` ("100+/day → no animation" rule) | **Yes** |
| **Dark mode** | `jakubkrehel/better-colors` (one hue, shift L), `emilkowalski/pick-ui-library` (next-themes, no-flash) | `jakubkrehel/better-ui` (suppress transitions on theme switch), `jakubkrehel/oklch-skill` (dark palette derivation) | **Yes** |
| **Page transitions** | `iart-ai/page-transition-animation` (FrozenRouter + `template.tsx`, or `next-view-transitions`) | `raphaelsalaja/mastering-animate-presence`, `emilkowalski/animate` | **Yes** |
| **Loading / Skeleton** | `shadcn-ui/shadcn` (`Skeleton`, no custom `animate-pulse`), `ibelick/baseline-ui` (structural skeletons for loading) | `vercel-labs/react-best-practices` (`rendering-usetransition-loading`), `jakubkrehel/better-ui` (`AnimatePresence initial={false}` on state swaps) | Yes |
| **Micro-interactions** (hover, press, state toggles) | `iart-ai/micro-interaction`, `jakubkrehel/better-ui` (`scale(0.96)` 150ms) | `jakubantalik/transitions-polish` (5-dim motion-token audit), `emilkowalski/animate` | Yes |
| **Charts (CPU/MEM/pod + CSV drift)** — service-performance | `shadcn-ui/shadcn` (`Chart` wraps Recharts), `larashero3-dotcom/lieflat-charts` (pick-by-shape discipline) | `emilkowalski/pick-ui-library` (Recharts default; Liveline for live-streaming only) | Yes |
| **Knowledge graph (GenZ Notes)** — force-directed graph | *(no registry skill; see §4)* | `vercel-labs/react-best-practices` (`rerender-*` for canvas), `ibelick/fixing-motion-performance` (rAF loop with stop condition) | No |
| **Icon system** (Lucide via `shadcn/iconLibrary`) | `shadcn-ui/shadcn` (`data-icon="inline-start"`, no sizing classes on button icons) | `jakubkrehel/better-ui` (icon stroke tracks text weight, `currentColor`) | **Yes** |
| **Accessibility** (cross-cutting) | `jakubkrehel/better-accessibility`, `ibelick/fixing-accessibility` | `wshobson/wcag-audit-patterns`, `iart-ai/accessible-animation` | **Yes** |
| **Mobile pass (deferred)** | `emilkowalski/mobile-native` (16px inputs, `100dvh`, safe-area, `touch-action`, kill tap highlight) | `flornkm/prefer-container-queries` (component-level responsive) | Yes (when work starts) |
| **PWA / Add-to-home (deferred)** | `joe-bell/apple-web-app` (manifest, theme-color per scheme, splash screens, iOS startup images) | `emilkowalski/mobile-native` (viewport, `interactive-widget=resizes-content`) | Yes (when work starts) |
| **Performance / React arch** (cross-cutting) | `vercel-labs/react-best-practices` (waterfalls, bundle, re-renders) | `ibelick/fixing-motion-performance` | Yes |
| **Review passes before shipping** | `ibelick/baseline-ui` (fast deslop), `vercel-labs/web-design-guidelines` (file-level) | `dammyjay93/interface-design` design-review command, `jakubkrehel/better-ui` audit | Yes |

### Hard rules absorbed from the skills (copy into v2 design system)

1. **No `transition-all`** → name properties (every motion skill).
2. **No `scale(0)` entrances** → start at `scale(0.95)` + `opacity: 0`.
3. **`ease-out` entrances; never `ease-in` on UI**; strong curve `cubic-bezier(0.23, 1, 0.32, 1)`.
4. **UI motion < 300ms**: tap 100–160ms, tooltip/popover 125–200ms, dropdown 150–250ms, modal/drawer 200–500ms.
5. **100+/day actions get zero animation** (command palette toggle, keyboard shortcuts).
6. **`var(--transform-origin)` on trigger-anchored popovers**, modals exempt.
7. **`@container` default; viewport breakpoints only for page-level chrome.**
8. **`100dvh` for app shell, `100svh` for heroes**, never `100vh` on mobile layouts.
9. **16px minimum input font-size** (iOS zoom fix).
10. **`(hover: hover) and (pointer: fine)` gate on every `:hover`.**
11. **`prefers-reduced-motion` is tiered**, not a kill switch; keep opacity/color + spinners, drop transforms.
12. **One `<Toaster>` mounted at root**, never per-page.
13. **FrozenRouter + pathname-keyed AnimatePresence** for App Router exit animations.
14. **Semantic tokens only in components** — never `bg-blue-500`; always `bg-primary`.
15. **Icons use `data-icon` on Button**, never sizing classes.
16. **Fields use `data-invalid` + control `aria-invalid`.**
17. **One primary action per view**; `AlertDialog` only for destructive/irreversible.

---

## 4. Open ui-skills questions

Concerns the registry does **not** cover (as of 2026-10-11). Go bespoke, document in `codebase_design.md`.

| Gap | Why it matters for v2 | Our plan |
|---|---|---|
| **Force-directed knowledge graph** (GenZ Notes) | No skill covers D3/SigmaJS/custom-canvas graph rendering, node selection, filter wiring. Current v1 ships `KnowledgeGraph` class. | Keep bespoke; apply `vercel-labs/react-best-practices` `rerender-*` + `ibelick/fixing-motion-performance` (stop-condition rAF, pause off-screen). |
| **Teamup / Google Sheets / Grafana iframe embeds** | CSP + iframe sandboxing is codebase-specific. | Inherit v1 `.htaccess` allowlist + Next middleware CSP. |
| **Multi-team feature flags** (sm vs dev vs genz) | Token/theme skills assume one app; our `body.is-genz` + `dev` subteam overlays are domain-specific. | Build on top of `shadcn/customization.md` theming; layer per-team CSS vars under `[data-team="genz"]`. |
| **File-based JSON storage write patterns** | All skills assume DB; our `teamDataPath()` + `readJson/writeJson` discipline is non-standard. | Not a UI concern; stays in `agents.md` + CLAUDE.md. |
| **OpenSearch log viewer / Prometheus-driven detail panes** | Charts skill is editorial-oriented (Lupi gallery). Recharts is good enough for live time-series; no skill covers Grafana-parity dashboards. | Use `shadcn/Chart` (Recharts) + copy v1 Grafana URL deeplink patterns. |
| **Jira / Jenkins issue creation forms** with dynamic custom-field metadata | shadcn's Field/InputGroup rules apply, but no skill covers runtime-schema forms. | Compose `react-hook-form` + shadcn `Field` + Zod inferred from Jira field metadata. |
| **Live presence indicator / websocket-driven UI** | No skill in registry addresses optimistic UI + conflict resolution for shared boards. | Reference `vercel-labs/react-best-practices` `client-*` + `rerender-transitions`; stays bespoke. |
| **Thai / Thai–English mixed content typography** | Typography skills (`jakubkrehel/better-typography`) are Latin-centric. | Set up Noto Sans Thai + Inter pairing, test `text-wrap: balance` on Thai headings, measure line-height per locale. |
| **Email / ICS artifact rendering** (incident-launcher) | ui-skills registry is browser-UI only. | Keep in `api/mail/` and ICS generators; the dashboard side uses `shadcn`+skills. |

---

## 5. Changelog

- 2026-10-11 — Initial audit of ui-skills.com registry against v2 PRD. 31 skills catalogued; 21 concerns mapped; 9 gaps logged.

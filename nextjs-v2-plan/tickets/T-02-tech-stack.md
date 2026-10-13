# T-02 — Tech stack: Next.js 15 + Tailwind v4 + shadcn/ui?

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed · Blocks: T-07, T-08

## Question

Lock the primary stack. What framework version, styling, component library?

## Context

- Current app is PHP + vanilla JS + CSS variables (4-theme system).
- 71 user pages + 73 admin pages means we want a **shadcn-style owned-source** component library, not a vendored CSS framework that fights our tokens.
- Dark-mode fidelity is a long-standing pain. Tailwind v4's native CSS variable export + `@theme` directive matches v1's current pattern (see `design_system.md` §2).

## Options

**A. Next.js 15 (App Router) + React 19 + Tailwind v4 + shadcn/ui + Radix** _(recommended)_
- Mature ecosystem; RSC trims client JS.
- Tailwind v4 native CSS variables ⇒ clean theme port.
- shadcn copies into repo ⇒ we can patch for theme tokens.

**B. Next.js 15 + Tailwind v3 + daisyUI**
- Simpler if we lean on daisyUI themes.
- But: we'd fight daisyUI's token namespace, and v4 is production-ready.

**C. Remix / React Router v7**
- Server loader model is nice, but ecosystem for the dashboard tooling we need (TanStack Table, shadcn) is thinner.

**D. Non-React (SvelteKit, SolidStart)**
- Would shrink client JS further but loses the shadcn ecosystem and the Lucide / Framer / GSAP integrations we rely on.

## Decisions this unlocks

- Theme token layer (T-07) depends on Tailwind v4 to short-circuit most of the CSS variable glue.
- Testing strategy (T-06) depends on whether we end up on React (Playwright + Vitest) or elsewhere.

## Resolution

**Decision:** Next.js 15 (App Router) + React 19 + TypeScript 5.x (`strict: true`) + Tailwind CSS v4 + shadcn/ui on Radix + `lucide-react` + `react-hook-form` + `zod` + Vitest + Playwright + `jose` + `proper-lockfile` + `nodemailer`.

**Why:**
1. Tailwind v4's native `@theme` + CSS variable export lines up 1-to-1 with v1's 4-theme OKLCH plan — zero adapter CSS.
2. shadcn copies source into our repo; we can patch for token bindings without forking a library.
3. RSC + Server Actions let us drop the hand-rolled `assets/js/api.js` wrapper for most mutations.
4. Zod schemas double as runtime guards for JSON reads (closes the v1 field-map drift class).
5. Ecosystem matches every recommended ui-skill in [`ui-skills-matrix.md`](../research/ui-skills-matrix.md).

**Follow-ups:**
- Lock exact minor versions in [T-05's](./T-05-team-scoping.md) scaffold ticket.
- Decide `conform-to` vs `react-hook-form` in [D-06](./D-06-conform-to.md) now unblocked.
- Theme token work in [T-07](./T-07-theme-system.md) now unblocked.

**Owner:** Chief Architect
**Date:** 2026-10-11

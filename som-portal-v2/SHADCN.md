<!-- som-portal-v2/SHADCN.md -->
# shadcn Component Setup

The scaffold ships hand-written minimal versions of six shadcn primitives under
`src/ui/shadcn/` (button, card, input, badge, skeleton, alert) so `/preview/theme`
compiles before any dependencies are installed.

Once `package.json` lands and `pnpm install` runs, replace the stubs with the
real shadcn components by running the CLI once per group below.

## Phase 1 install list

Run after Agent A ships `package.json`, `tsconfig.json`, and `next.config.ts`:

```bash
pnpm dlx shadcn@latest init           # pick: new-york · neutral · cssVariables yes
# forms
pnpm dlx shadcn@latest add button input textarea label select checkbox switch form
# feedback
pnpm dlx shadcn@latest add alert toast sonner skeleton progress
# surfaces
pnpm dlx shadcn@latest add card badge avatar separator
# overlays
pnpm dlx shadcn@latest add dialog sheet popover tooltip dropdown-menu context-menu
# nav & data
pnpm dlx shadcn@latest add tabs accordion collapsible command table pagination
# combobox (built on command + popover)
pnpm dlx shadcn@latest add combobox
```

## Rules

- `components.json` aliases are set so shadcn generates into `src/ui/shadcn/`.
  Do **not** let the CLI overwrite anything outside that folder.
- After each `add`, delete the matching stub in `src/ui/shadcn/*.tsx` (the
  CLI will have already overwritten it with the real one).
- Portaled components (DialogPortal, PopoverPortal, Sonner Toaster) must read
  from `:root` CSS variables, never scoped ones — see
  `nextjs-v2-plan/design_system.md` §2 and the `feedback_scoped_css_vars_body_append` memory.
- Do **not** install `next-themes`. We own the theme provider at
  `src/theme/ThemeProvider.tsx` (console-forces-dark, GenZ overlay).

## What the first module (Login + Dashboard) still needs

- `pnpm add react-hook-form @hookform/resolvers zod sonner lucide-react clsx tailwind-merge`
- shadcn `form`, `input`, `button`, `card`, `alert`, `toast` installed above
- Agent A: `src/auth/getSession()` + the `/v2/api/auth/login` route handler

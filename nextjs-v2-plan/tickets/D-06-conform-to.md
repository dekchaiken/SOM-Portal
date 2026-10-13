# D-06 — Adopt `conform-to` for Server Action forms?

> Type: `decision` · HITL · Blocked by: T-02 · Owner: unclaimed · Source: codebase_design.md §9

## Question

Pair with `react-hook-form` (client-side) or adopt `@conform-to/react` + `@conform-to/zod` (progressive-enhancement, Zod-first, SA-native)?

## Options

**A. `react-hook-form` + manual SA wiring** — large community, more ceremony with SAs.
**B. `conform-to`** — purpose-built for Server Actions + Zod, smaller community but production-ready.
**C. Both — pick per form, by complexity**.

## Recommendation

Prototype one form each way during Phase 0 and pick. Don't lock in on paper.

## Resolution

**Decision:** `react-hook-form` + manual Server Action wiring. Use shadcn's `Form` component (which is RHF-based) for every form.

```tsx
// pattern (sketch)
'use client';
const form = useForm<Input>({ resolver: zodResolver(schema) });
async function onSubmit(data: Input) {
  const result = await createBoardPost(data);
  if (!result.ok) { form.setError('root', { message: result.error }); return; }
  toast.success('Created');
}
```

**Why RHF:**
1. shadcn's `Form` composition is RHF-native — not having to pick a library for every form.
2. Larger community + more Stack Overflow answers.
3. Zod resolver (`@hookform/resolvers/zod`) is first-class.
4. `conform-to` is better theoretically (progressive enhancement without JS) but we're building an internal tool — users won't disable JS, and the DX trade-off isn't worth it.

**Follow-ups:**
- Admin forms (system-settings, menu-permissions) stress-test this choice early. Revisit at Phase 2 if ceremony is too high.

**Owner:** Chief Architect
**Date:** 2026-10-11

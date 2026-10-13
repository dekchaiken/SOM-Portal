# R-03 — OpenSearch per-user credentials: encryption migration

> Type: `research` · AFK · Blocked by: — · Owner: unclaimed

## Question

How does v2 re-use v1's AES-256-encrypted per-user OpenSearch credentials without forcing every user to re-enter them?

## Why

Memory `project_log_explorer`: v1 ships AES-256 encrypted creds in `api/opensearch-user-creds/`. The key material is in `.env`. We need v2 to read + decrypt the same blob, re-encrypt for v2's own storage if needed, and migrate transparently.

## Scope

1. Document the v1 crypto: cipher mode, IV handling, salt, key derivation.
2. Determine whether v2 can import the exact same key material (yes, if `.env` is shared).
3. Decide if v2 keeps the same ciphertext format or re-wraps on first access.
4. Prototype a `src/opensearch/creds.ts` with:
   - `decrypt(userId): Promise<Creds>`
   - `encrypt(userId, creds): Promise<void>`
   - A one-time migration flag so a user who logs in through v2 gets their blob re-wrapped if we change the format.
5. Audit the DSL builder for Log Explorer saved searches — same shape in v2?

## Deliverable

- `nextjs-v2-plan/research/opensearch-creds.md`
- `nextjs-v2-plan/research/opensearch-creds.proposed.ts`

## Resolution

_pending_

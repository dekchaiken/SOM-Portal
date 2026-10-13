// som-portal-v2/src/mail/recipients.ts
// Recipient list rules shared by the send route and the admin pages.
// Addresses are trimmed, lower-cased for de-duplication, and must look like email.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RecipientSplit {
  valid: string[];
  invalid: string[];
}

/** Split free text ("a@x.com, b@y.com;c@z.com") into valid and invalid addresses. */
export function parseRecipients(input: string | string[]): RecipientSplit {
  const raw = Array.isArray(input) ? input : [input];
  const parts = raw.flatMap((s) => s.split(/[\s,;]+/));
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    const addr = part.trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (!EMAIL_RE.test(addr)) {
      invalid.push(addr);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(addr);
  }
  return { valid, invalid };
}

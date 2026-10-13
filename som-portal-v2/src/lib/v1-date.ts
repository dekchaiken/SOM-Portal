// som-portal-v2/src/lib/v1-date.ts
//
// v1 PHP calls `date_default_timezone_set('Asia/Bangkok')` (api/helpers.php:5)
// and stamps records with `date('c')`, producing e.g.
//   2026-10-02T15:52:38+07:00
// `new Date().toISOString()` would write `...Z`, which still parses but makes
// the v1 files visibly inconsistent and breaks string-sorted comparisons.

const BANGKOK_OFFSET_MINUTES = 7 * 60;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** PHP `date('c')` in Asia/Bangkok. */
export function v1Date(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + BANGKOK_OFFSET_MINUTES * 60_000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `+07:00`
  );
}

/** PHP `strtotime($s)` → epoch seconds, or 0 when unparsable (v1 used `?: 0`). */
export function v1Strtotime(value: unknown): number {
  if (typeof value !== 'string' || value === '') return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

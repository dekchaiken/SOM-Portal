<?php
// ─────────────────────────────────────────────────────────────────────────────
//  Batch File Index — File → Job Lookup (Sprint 2)
//
//  Given a filename the user pastes (usually from another team asking "please
//  send me file X for date Y"), return which batch job produced it — along
//  with dev_owner, manual_url, and sm_rerun instructions from batch_meta.
//
//  Match strategy (tiered — first non-empty tier wins):
//    1) EXACT     — normalized filename hits an index key directly
//    2) SUBSTRING — normalized filename contains an index key, or vice versa
//    3) FUZZY     — token overlap ≥ 2, ranked by score
//
//  Endpoint:
//    POST /api/batch-file-index/lookup.php   { filename: "..." }
// ─────────────────────────────────────────────────────────────────────────────
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
if ($method !== 'POST') respondError('Method not allowed', 405);
// Feature-gated: caller's team must have `batch-file-search` granted.
// SM keeps write access (crawl.php / index_logs.php still requireSmForShared),
// but any team super_admin has enabled can perform read-only lookups.
requireTeamFeature($payload, 'batch-file-search');
requireCsrf();

$body     = getBody();
$filename = trim($body['filename'] ?? '');
if ($filename === '') respondError('filename required');
// Strip whitespace, common wrapping quotes, and trailing "sending as attachment" noise
$cleaned = trim($filename, "\r\n \t\"'`");

// Same normalization the indexer uses — runs of 6+ digits become <N>.
function _bfxNormalize(string $raw): string {
    return preg_replace('/\d{6,}/', '<N>', $raw);
}
function _bfxTokens(string $s): array {
    $s = strtolower($s);
    $parts = preg_split('/[^a-z0-9]+/', $s);
    return array_values(array_filter($parts, fn($t) => strlen($t) >= 3 && !ctype_digit($t)));
}

$normalized = _bfxNormalize($cleaned);

// Load index (SM-shared file).
$index    = readJson('batch_file_index.json');
$patterns = is_array($index) && isset($index['patterns']) && is_array($index['patterns'])
          ? $index['patterns'] : [];

$matches       = [];
$tier          = null;

// ── Tier 1 — exact normalized key hit ────────────────────────────────────────
if (isset($patterns[$normalized])) {
    $tier = 'exact';
    foreach ($patterns[$normalized] as $entry) {
        $matches[] = [
            'pattern'    => $normalized,
            'confidence' => 'exact',
            'entry'      => $entry,
        ];
    }
}

// ── Tier 2 — substring (bidirectional) ───────────────────────────────────────
if (!$matches) {
    $needle = strtolower($normalized);
    foreach ($patterns as $key => $entries) {
        $kl = strtolower($key);
        if ($kl === '' || $kl === $needle) continue;
        // Substring in either direction: the needle contains a stored key, or
        // vice versa — both hint at the same batch job family.
        if (strpos($needle, $kl) !== false || strpos($kl, $needle) !== false) {
            foreach ($entries as $entry) {
                $matches[] = [
                    'pattern'    => $key,
                    'confidence' => 'partial',
                    'entry'      => $entry,
                ];
            }
        }
        if (count($matches) >= 40) break;
    }
    if ($matches) $tier = 'partial';
}

// ── Tier 3 — token overlap fallback ──────────────────────────────────────────
if (!$matches) {
    $needleToks = _bfxTokens($cleaned);
    if ($needleToks) {
        $scored = [];
        $needleSet = array_flip($needleToks);
        foreach ($patterns as $key => $entries) {
            $keyToks = _bfxTokens($key);
            if (!$keyToks) continue;
            $overlap = 0;
            foreach ($keyToks as $t) if (isset($needleSet[$t])) $overlap++;
            if ($overlap < 2) continue;
            $scored[] = ['key' => $key, 'entries' => $entries, 'score' => $overlap];
        }
        usort($scored, fn($a, $b) => $b['score'] - $a['score']);
        foreach (array_slice($scored, 0, 15) as $s) {
            foreach ($s['entries'] as $entry) {
                $matches[] = [
                    'pattern'    => $s['key'],
                    'confidence' => 'fuzzy',
                    'score'      => $s['score'],
                    'entry'      => $entry,
                ];
            }
        }
        if ($matches) $tier = 'fuzzy';
    }
}

// ── Enrich with batch_meta so users see dev_owner, sm_rerun, manual_url ──────
// batch_meta.json is per-team (routed via readJson). SM's copy has the fullest
// mapping; other teams only get theirs.
$bmeta      = readJson('batch_meta.json');
$bmEntries  = is_array($bmeta) && isset($bmeta['entries']) && is_array($bmeta['entries'])
            ? $bmeta['entries'] : [];
$bmByExact  = [];
foreach ($bmEntries as $e) {
    $p = $e['pattern'] ?? '';
    if ($p !== '') $bmByExact[$p] = $e;
}
$_findBm = function (string $jobName) use ($bmByExact, $bmEntries) {
    if (isset($bmByExact[$jobName])) return $bmByExact[$jobName];
    // Fall back: entry whose pattern is substring of the job name (contains rule).
    foreach ($bmEntries as $e) {
        $p = $e['pattern'] ?? '';
        if ($p !== '' && strpos($jobName, $p) !== false) return $e;
    }
    return null;
};

foreach ($matches as &$m) {
    $jobName = $m['entry']['job_name'] ?? '';
    $bm = $_findBm($jobName);
    if ($bm) {
        $m['batch_meta'] = [
            'dev_owner'  => $bm['dev_owner']  ?? '',
            'sm_rerun'   => $bm['sm_rerun']   ?? '',
            'manual_url' => $bm['manual_url'] ?? '',
            'category'   => $bm['category']   ?? '',
            'note'       => $bm['note']       ?? '',
        ];
    }
}
unset($m);

// De-duplicate by (server_id, job_path) — a job can hit several patterns; we
// only want to show it once, keeping the highest-confidence hit.
$dedup      = [];
$rankOrder  = ['exact' => 0, 'partial' => 1, 'fuzzy' => 2];
foreach ($matches as $m) {
    $key = ($m['entry']['server_id'] ?? '') . '|' . ($m['entry']['job_path'] ?? '');
    if (!isset($dedup[$key]) ||
        $rankOrder[$m['confidence']] < $rankOrder[$dedup[$key]['confidence']]) {
        $dedup[$key] = $m;
    }
}
$matches = array_values($dedup);

// Sort: confidence tier, then fuzzy score desc, then last_seen recency
usort($matches, function ($a, $b) use ($rankOrder) {
    if ($rankOrder[$a['confidence']] !== $rankOrder[$b['confidence']]) {
        return $rankOrder[$a['confidence']] - $rankOrder[$b['confidence']];
    }
    if (($b['score'] ?? 0) !== ($a['score'] ?? 0)) return ($b['score'] ?? 0) - ($a['score'] ?? 0);
    return strcmp($b['entry']['last_seen_at'] ?? '', $a['entry']['last_seen_at'] ?? '');
});

logActivity('batch_file_index_lookup', [
    'filename_len'  => strlen($cleaned),
    'normalized_len'=> strlen($normalized),
    'tier'          => $tier,
    'match_count'   => count($matches),
], $payload['sub'], $payload['name']);

respondOk([
    'filename'       => $filename,
    'cleaned'        => $cleaned,
    'normalized'     => $normalized,
    'tier'           => $tier,
    'total'          => count($matches),
    'matches'        => array_slice($matches, 0, 25),
    'index_size'     => count($patterns),
    'index_generated'=> $index['generated_at'] ?? null,
]);

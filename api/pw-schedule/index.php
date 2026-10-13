<?php
/**
 * pw-schedule/index.php
 *
 * Planwork Schedule CRUD — per-round (date group) + item operations.
 *
 * A "round" groups PW items for one overnight shift (e.g. "2026-05-13" covers
 * the 13→14 May shift). Each round stores an array of items (planwork entries)
 * and their completed state (checklist).
 *
 * Endpoints (all require auth, ALL_STAFF_ROLES can read/write items):
 *   GET    /?list_rounds=1                  → list rounds (id + counts)
 *   GET    /?round=YYYY-MM-DD               → fetch one round with items
 *   GET    /?active=1                       → fetch active/current round
 *   POST   /                                → create item (body: round, type, pw_name, start, end, mop, meet, task, impact, owner, remark, ticket)
 *   PUT    /?id=ITEM_ID                     → update item fields
 *   PATCH  /?id=ITEM_ID&action=toggle       → toggle completed
 *   DELETE /?id=ITEM_ID                     → delete item
 *
 * Data file: data/pw_schedule.json
 *   [
 *     {
 *       "round": "2026-05-13",
 *       "created_at": "...",
 *       "items": [ { id, type, pw_name, start, end, mop, meet, task, impact, owner, remark, ticket, completed, created_at, created_by } ]
 *     }
 *   ]
 */
require_once __DIR__ . '/../helpers.php';

$method  = $_SERVER['REQUEST_METHOD'];
$payload = requireAuth();

// Feature-gate reads: caller's team must have 'pw-schedule' granted (SM plus
// any team super_admin has explicitly shared with). Writes are handled by
// requireSmForShared() below in each write branch — non-SM teams can VIEW
// SM's rounds but not mutate them.
if ($method === 'GET') {
    requireTeamFeature($payload, 'pw-schedule');
}

const PW_FILE = 'pw_schedule.json';

/** Determine the "round" key for a given ISO datetime string.
 *  Rule: the round is the DATE of the SHIFT START.
 *  Anything from 12:00 onwards belongs to that calendar date's round.
 *  Anything before 12:00 is considered tail of the previous date's round. */
function pwRoundKeyFromStart(string $iso): string {
    $ts = strtotime($iso);
    if ($ts === false) return date('Y-m-d');
    $h = (int)date('H', $ts);
    if ($h < 12) {
        return date('Y-m-d', $ts - 86400);
    }
    return date('Y-m-d', $ts);
}

function pwFindRound(array &$rounds, string $roundKey): ?int {
    foreach ($rounds as $i => $r) {
        if (($r['round'] ?? '') === $roundKey) return $i;
    }
    return null;
}

function pwSortItems(array &$items): void {
    usort($items, fn($a, $b) => strcmp($a['start'] ?? '', $b['start'] ?? ''));
}

function pwSanitizeItem(array $body, array $payload, ?array $existing = null): array {
    $now = date('c');
    $item = $existing ?? [
        'id'         => genId('pw'),
        'completed'  => false,
        'created_at' => $now,
        'created_by' => $payload['name'] ?? $payload['sub'],
    ];

    $fields = ['type','pw_name','start','end','mop','meet','task','impact','owner','remark','ticket'];
    foreach ($fields as $f) {
        if (array_key_exists($f, $body)) {
            $item[$f] = is_string($body[$f]) ? trim($body[$f]) : $body[$f];
        } elseif (!isset($item[$f])) {
            $item[$f] = '';
        }
    }

    // Attachments: array of { url?, caption? } — one of the two must be present.
    // An item with a url is an image; an item with only caption is a text note.
    if (array_key_exists('attachments', $body)) {
        $cleaned = [];
        if (is_array($body['attachments'])) {
            foreach ($body['attachments'] as $att) {
                if (!is_array($att)) continue;
                $url     = trim((string)($att['url'] ?? ''));
                $caption = trim((string)($att['caption'] ?? ''));
                if ($url === '' && $caption === '') continue;
                $cleaned[] = [
                    'url'      => $url,
                    'caption'  => $caption,
                    'kind'     => $url !== '' ? 'image' : 'note',
                    'added_at' => $att['added_at'] ?? date('c'),
                ];
            }
        }
        $item['attachments'] = $cleaned;
    } elseif (!isset($item['attachments'])) {
        $item['attachments'] = [];
    }

    // Type whitelist
    if (!in_array($item['type'] ?? '', ['INTERNAL','EXTERNAL'], true)) {
        $item['type'] = 'INTERNAL';
    }

    if ($existing) {
        $item['updated_at'] = $now;
        $item['updated_by'] = $payload['name'] ?? $payload['sub'];
    }
    return $item;
}

// ── GET ───────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $rounds = readJson(PW_FILE);

    // List rounds summary
    if (!empty($_GET['list_rounds'])) {
        $summary = array_map(function($r) {
            $items = $r['items'] ?? [];
            $done  = count(array_filter($items, fn($i) => !empty($i['completed'])));
            return [
                'round'      => $r['round'],
                'total'      => count($items),
                'completed'  => $done,
                'all_done'   => count($items) > 0 && $done === count($items),
                'created_at' => $r['created_at'] ?? null,
            ];
        }, $rounds);
        usort($summary, fn($a, $b) => strcmp($b['round'], $a['round']));
        respondOk($summary);
    }

    // Single round
    if (!empty($_GET['round'])) {
        $key = $_GET['round'];
        $idx = pwFindRound($rounds, $key);
        if ($idx === null) respondOk(['round' => $key, 'items' => []]);
        $r = $rounds[$idx];
        pwSortItems($r['items']);
        respondOk($r);
    }

    // Active round: earliest round with at least one incomplete item whose end is
    // in the future, OR round with any item currently between start/end.
    if (!empty($_GET['active'])) {
        $now = time();
        $candidate = null;
        // Sort ascending by round date
        usort($rounds, fn($a, $b) => strcmp($a['round'], $b['round']));
        foreach ($rounds as $r) {
            $items = $r['items'] ?? [];
            if (empty($items)) continue;
            $hasOpen = false;
            foreach ($items as $it) {
                if (empty($it['completed'])) { $hasOpen = true; break; }
            }
            // Also consider rounds whose last-end is still in the future
            $maxEnd = 0;
            foreach ($items as $it) {
                $t = strtotime($it['end'] ?? '');
                if ($t && $t > $maxEnd) $maxEnd = $t;
            }
            if ($hasOpen || $maxEnd > $now) {
                $candidate = $r;
                break;
            }
        }
        if (!$candidate) {
            // Fall back to latest round
            usort($rounds, fn($a, $b) => strcmp($b['round'], $a['round']));
            $candidate = $rounds[0] ?? ['round' => date('Y-m-d'), 'items' => []];
        }
        pwSortItems($candidate['items']);
        respondOk($candidate);
    }

    // Default: all rounds (sorted desc) with items
    usort($rounds, fn($a, $b) => strcmp($b['round'], $a['round']));
    foreach ($rounds as &$r) pwSortItems($r['items']);
    unset($r);
    respondOk($rounds);
}

// ── POST: create item ─────────────────────────────────────────────────
if ($method === 'POST') {
    requireSmForShared();
    $body = getBody();
    if (empty($body['pw_name']))  respondError('pw_name is required', 400);
    if (empty($body['start']))    respondError('start is required', 400);
    if (empty($body['end']))      respondError('end is required', 400);

    $startTs = strtotime($body['start']);
    $endTs   = strtotime($body['end']);
    if (!$startTs || !$endTs) respondError('Invalid start/end datetime', 400);
    if ($endTs <= $startTs)   respondError('end must be after start', 400);

    $roundKey = !empty($body['round']) ? $body['round'] : pwRoundKeyFromStart($body['start']);

    $rounds = readJson(PW_FILE);
    $idx    = pwFindRound($rounds, $roundKey);
    if ($idx === null) {
        $rounds[] = [
            'round'      => $roundKey,
            'created_at' => date('c'),
            'items'      => [],
        ];
        $idx = count($rounds) - 1;
    }

    $item = pwSanitizeItem($body, $payload);
    $rounds[$idx]['items'][] = $item;
    pwSortItems($rounds[$idx]['items']);

    writeJson(PW_FILE, $rounds);
    logActivity('pw_item_created', [
        'round' => $roundKey,
        'id'    => $item['id'],
        'name'  => mb_substr($item['pw_name'], 0, 100),
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk(['round' => $roundKey, 'item' => $item]);
}

// ── PUT: update item ──────────────────────────────────────────────────
if ($method === 'PUT') {
    requireSmForShared();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id required', 400);
    $body = getBody();

    $rounds = readJson(PW_FILE);
    $updatedItem = null;
    $roundKey    = null;

    foreach ($rounds as $ri => &$r) {
        foreach ($r['items'] as $ii => $it) {
            if ($it['id'] === $id) {
                if (isset($body['start']) || isset($body['end'])) {
                    $newStart = $body['start'] ?? $it['start'];
                    $newEnd   = $body['end']   ?? $it['end'];
                    $sTs = strtotime($newStart);
                    $eTs = strtotime($newEnd);
                    if (!$sTs || !$eTs) respondError('Invalid start/end datetime', 400);
                    if ($eTs <= $sTs)   respondError('end must be after start', 400);
                }
                $r['items'][$ii] = pwSanitizeItem($body, $payload, $it);
                // If the start changed, the round key may need to change too
                if (isset($body['start'])) {
                    $newKey = pwRoundKeyFromStart($r['items'][$ii]['start']);
                    if ($newKey !== $r['round'] && empty($body['round'])) {
                        $moved = $r['items'][$ii];
                        array_splice($r['items'], $ii, 1);
                        // Clean up empty round
                        if (empty($r['items'])) {
                            array_splice($rounds, $ri, 1);
                        }
                        // Place in destination round
                        $destIdx = pwFindRound($rounds, $newKey);
                        if ($destIdx === null) {
                            $rounds[] = ['round' => $newKey, 'created_at' => date('c'), 'items' => []];
                            $destIdx  = count($rounds) - 1;
                        }
                        $rounds[$destIdx]['items'][] = $moved;
                        pwSortItems($rounds[$destIdx]['items']);
                        $updatedItem = $moved;
                        $roundKey    = $newKey;
                        writeJson(PW_FILE, $rounds);
                        logActivity('pw_item_updated', ['id' => $id, 'round' => $roundKey], $payload['sub'], $payload['name'] ?? '');
                        respondOk(['round' => $roundKey, 'item' => $updatedItem]);
                    }
                }
                pwSortItems($r['items']);
                $updatedItem = $r['items'][$ii];
                $roundKey    = $r['round'];
                writeJson(PW_FILE, $rounds);
                logActivity('pw_item_updated', ['id' => $id, 'round' => $roundKey], $payload['sub'], $payload['name'] ?? '');
                respondOk(['round' => $roundKey, 'item' => $updatedItem]);
            }
        }
    }
    unset($r);
    respondError('Item not found', 404);
}

// ── PATCH: toggle completed ───────────────────────────────────────────
if ($method === 'PATCH') {
    requireSmForShared();
    $id     = $_GET['id']     ?? '';
    $action = $_GET['action'] ?? 'toggle';
    if (!$id) respondError('id required', 400);

    $body = getBody();
    $rounds = readJson(PW_FILE);
    foreach ($rounds as &$r) {
        foreach ($r['items'] as &$it) {
            if ($it['id'] === $id) {
                if ($action === 'toggle') {
                    $it['completed'] = !(!empty($it['completed']));
                } elseif ($action === 'set') {
                    $it['completed'] = !empty($body['completed']);
                } else {
                    respondError('Unknown action', 400);
                }
                $it['completed_at'] = !empty($it['completed']) ? date('c') : null;
                $it['completed_by'] = !empty($it['completed']) ? ($payload['name'] ?? $payload['sub']) : null;
                writeJson(PW_FILE, $rounds);
                logActivity('pw_item_toggle', [
                    'id'        => $id,
                    'round'     => $r['round'],
                    'completed' => (bool)$it['completed'],
                ], $payload['sub'], $payload['name'] ?? '');
                respondOk(['round' => $r['round'], 'item' => $it]);
            }
        }
        unset($it);
    }
    unset($r);
    respondError('Item not found', 404);
}

// ── DELETE ────────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireSmForShared();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id required', 400);

    $rounds = readJson(PW_FILE);
    foreach ($rounds as $ri => &$r) {
        foreach ($r['items'] as $ii => $it) {
            if ($it['id'] === $id) {
                array_splice($r['items'], $ii, 1);
                if (empty($r['items'])) {
                    array_splice($rounds, $ri, 1);
                }
                writeJson(PW_FILE, $rounds);
                logActivity('pw_item_deleted', ['id' => $id], $payload['sub'], $payload['name'] ?? '');
                respondOk(['deleted' => true]);
            }
        }
    }
    unset($r);
    respondError('Item not found', 404);
}

respondError('Method not allowed', 405);

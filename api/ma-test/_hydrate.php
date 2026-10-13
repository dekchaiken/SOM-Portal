<?php
/**
 * Shared helper — merge live values from ma-services usecases into
 * ma-test-catalog entries whenever a catalog field is empty.
 *
 * "Empty" = null, "", or the "-" placeholder used in seed CSV.
 * Catalog values that are set (non-empty, not "-") always win — user
 * overrides never get overwritten. Requires `usecase_id` to be linked.
 *
 * Used by:
 *   api/ma-test/catalog.php  (GET list + single)
 *   api/ma-test/plans.php    (_loadCatalogMap when enriching plan rows)
 */

function _usecaseMap(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $path = teamDataPath('ma-services.json');
    if (!file_exists($path)) { $cache = []; return $cache; }
    $d = json_decode(file_get_contents($path), true);
    $cache = [];
    foreach (($d['services'] ?? []) as $u) $cache[(int)$u['id']] = $u;
    return $cache;
}

// Fields the catalog inherits from usecase when its own value is empty.
// Each entry: extractor (pull value from ma-services usecase) + blank test.
// URL fields treat non-URL strings (like "-", "Link", "LINK") as blank so
// seed placeholders don't block inheritance from the linked usecase.
function _hydrateFieldMap(): array {
    return [
        'name'               => ['extract' => fn($u) => (string)($u['service_name'] ?? ''),                       'isBlank' => '_isBlank'],
        'service'            => ['extract' => fn($u) => strtoupper((string)($u['service_type'] ?? '')),           'isBlank' => '_isBlank'],
        'tool'               => ['extract' => fn($u) => (string)($u['tool_type'] ?? ''),                          'isBlank' => '_isBlank'],
        'graph_url'          => ['extract' => fn($u) => (string)($u['grafana_link'] ?? ''),                       'isBlank' => '_isBlankUrl'],
        'link_manual'        => ['extract' => fn($u) => (string)($u['link_manual'] ?? ''),                        'isBlank' => '_isBlankUrl'],
        'opensearch_url'     => ['extract' => fn($u) => (string)($u['opensearch_url'] ?? ''),                     'isBlank' => '_isBlankUrl'],
        'remark'             => ['extract' => fn($u) => (string)($u['remark'] ?? ''),                             'isBlank' => '_isBlank'],
        'can_change_message' => ['extract' => fn($u) => strtoupper((string)($u['can_change_text'] ?? '')),        'isBlank' => '_isBlank'],
    ];
}

// Treat null/""/"-" as empty (seed CSV uses "-" as a placeholder)
function _isBlank($v): bool {
    if ($v === null) return true;
    $s = trim((string)$v);
    return $s === '' || $s === '-';
}

// URL fields: anything that isn't http(s):// is a placeholder — treat as blank
function _isBlankUrl($v): bool {
    if (_isBlank($v)) return true;
    return !preg_match('#^https?://#i', trim((string)$v));
}

// Hydrate a single catalog item in-place-like: returns a new array.
// Adds `_from_usecase` = [field names that were inherited] for UI hinting.
function hydrateCatalogItem(array $item): array {
    $uid = (int)($item['usecase_id'] ?? 0);
    if (!$uid) return $item;
    $usecases = _usecaseMap();
    $u = $usecases[$uid] ?? null;
    if (!$u) return $item;
    $inherited = [];
    foreach (_hydrateFieldMap() as $catKey => $spec) {
        $isBlankFn = $spec['isBlank'];
        if (!$isBlankFn($item[$catKey] ?? null)) continue;
        $val = ($spec['extract'])($u);
        if ($isBlankFn($val)) continue;
        $item[$catKey] = $val;
        $inherited[] = $catKey;
    }
    if ($inherited) $item['_from_usecase'] = $inherited;
    return $item;
}

function hydrateCatalogList(array $items): array {
    $out = [];
    foreach ($items as $it) $out[] = hydrateCatalogItem($it);
    return $out;
}

// Inverse of hydrate: when a catalog field's value exactly matches the linked
// usecase's value, blank it in storage so future usecase updates propagate.
// Called on POST/PUT so catalog persists only user-specific overrides.
// `keys` limits which fields to check (defaults to all hydratable fields).
function stripInheritedValues(array $item, ?array $keys = null): array {
    $uid = (int)($item['usecase_id'] ?? 0);
    if (!$uid) return $item;
    $usecases = _usecaseMap();
    $u = $usecases[$uid] ?? null;
    if (!$u) return $item;
    $map = _hydrateFieldMap();
    foreach ($map as $catKey => $spec) {
        if ($keys !== null && !in_array($catKey, $keys, true)) continue;
        if (!array_key_exists($catKey, $item)) continue;
        $usecaseVal = ($spec['extract'])($u);
        $isBlankFn = $spec['isBlank'];
        if ($isBlankFn($usecaseVal)) continue;
        $catVal = trim((string)$item[$catKey]);
        if ($catVal === $usecaseVal) $item[$catKey] = '';
    }
    return $item;
}


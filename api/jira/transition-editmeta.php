<?php
/**
 * Fetch metadata for a list of fields on a specific issue.
 *
 * Used as a fallback when Jira enforces required fields via workflow
 * validators (not via the Transition Screen) — in that case
 * /transitions?expand=transitions.fields returns no fields, but the
 * validator still rejects the transition with
 *   "Fields required for this transition: X, Y, Z"
 *
 * Given those field names, this endpoint resolves each one to its
 * field id and metadata (type, allowedValues, required flag) by
 * combining /rest/api/3/field (name → id lookup) with
 * /rest/api/3/issue/{key}/editmeta (per-issue field schema).
 *
 * POST /api/jira/transition-editmeta.php
 * Body: { key: "SMC-123", fieldNames: ["Resolved after incident", ...] }
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $body       = getBody();
    $key        = trim($body['key'] ?? '');
    $fieldNames = $body['fieldNames'] ?? [];

    if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);
    if (!is_array($fieldNames) || !$fieldNames)       respondError('fieldNames required', 400);

    $basicAuth = 'Basic ' . base64_encode(jiraEmail() . ':' . jiraToken());
    $headers   = [
        'Authorization: ' . $basicAuth,
        'Accept: application/json',
    ];

    // ── 1) Fetch the issue's editmeta (per-issue field schema + allowedValues)
    $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/editmeta');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    $editResp = curl_exec($ch);
    $editErr  = curl_error($ch);
    $editCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($editErr)          respondError('Cannot reach Jira (editmeta): ' . $editErr, 502);
    if ($editCode !== 200) respondError('Jira editmeta HTTP ' . $editCode, 502);

    $editData   = json_decode($editResp, true) ?? [];
    $editFields = $editData['fields'] ?? [];

    // ── 2) Also fetch /field (global id ↔ name mapping) as a secondary source
    //       in case the field isn't in editmeta (e.g. validator-only fields).
    $fieldIndex = [];
    $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/field');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    $fieldResp = curl_exec($ch);
    curl_close($ch);
    $allFields = json_decode($fieldResp, true) ?? [];
    foreach ($allFields as $f) {
        if (!empty($f['name']) && !empty($f['id'])) {
            $fieldIndex[strtolower($f['name'])] = $f;
        }
    }

    // Build a lookup of editmeta by name AND by id (Jira error messages can use either)
    $editByName = [];
    $editById   = [];
    foreach ($editFields as $fieldId => $f) {
        $editById[$fieldId] = $f;
        if (!empty($f['name'])) $editByName[strtolower($f['name'])] = [$fieldId, $f];
    }

    // ── 3) Resolve each requested name
    $out        = [];
    $unresolved = [];
    foreach ($fieldNames as $rawName) {
        $name = trim((string)$rawName);
        if ($name === '') continue;
        $lc = strtolower($name);

        // Prefer editmeta (has allowedValues scoped to this issue)
        if (isset($editByName[$lc])) {
            [$fid, $f] = $editByName[$lc];
            $out[] = shapeField($fid, $f);
            continue;
        }
        // Maybe it's already a field id
        if (isset($editById[$name])) {
            $out[] = shapeField($name, $editById[$name]);
            continue;
        }
        // Fall back to global /field — we get the id + name but no allowedValues,
        // which means the modal will render a free-text input. Better than nothing.
        if (isset($fieldIndex[$lc])) {
            $gf  = $fieldIndex[$lc];
            $fid = $gf['id'];
            // Try editmeta by resolved id
            if (isset($editById[$fid])) {
                $out[] = shapeField($fid, $editById[$fid]);
            } else {
                $out[] = [
                    'fieldId'       => $fid,
                    'name'          => $gf['name'] ?? $name,
                    'required'      => true,
                    'type'          => $gf['schema']['type'] ?? 'string',
                    'items'         => $gf['schema']['items'] ?? null,
                    'allowedValues' => [],
                    'hasSearch'     => false,
                ];
            }
            continue;
        }
        $unresolved[] = $name;
    }

    respondOk([
        'fields'     => $out,
        'unresolved' => $unresolved,
    ]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage(), 500);
}

function shapeField(string $fieldId, array $f): array {
    $allowed = [];
    foreach ($f['allowedValues'] ?? [] as $av) {
        $allowed[] = [
            'id'          => $av['id']          ?? null,
            'value'       => $av['value']       ?? $av['name'] ?? ($av['id'] ?? ''),
            'accountId'   => $av['accountId']   ?? null,
            'displayName' => $av['displayName'] ?? $av['value'] ?? $av['name'] ?? null,
        ];
    }
    return [
        'fieldId'       => $fieldId,
        'name'          => $f['name']     ?? $fieldId,
        'required'      => true, // caller asked for it because Jira said it was required
        'type'          => $f['schema']['type']  ?? 'string',
        'items'         => $f['schema']['items'] ?? null,
        'allowedValues' => $allowed,
        'hasSearch'     => !empty($f['autoCompleteUrl']),
    ];
}

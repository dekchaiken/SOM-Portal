<?php
require_once __DIR__ . '/../helpers.php';

$payload  = requireAuth();
$method   = $_SERVER['REQUEST_METHOD'];
$id       = $_GET['id']     ?? '';
$parent   = $_GET['parent'] ?? '';

// ── helpers ────────────────────────────────────────────────
function filterEmails(array $list): array {
    return array_values(array_filter(
        array_map('trim', $list),
        fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
    ));
}

// GET — return all service types (with subtypes + services)
if ($method === 'GET') {
    $types = readJson('service_types.json');
    usort($types, fn($a, $b) => ($a['order'] ?? 99) - ($b['order'] ?? 99));
    respondOk($types);
}

// POST — create service type | subtype | service (3rd level)
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    $body = getBody();
    $name = trim($body['name'] ?? '');
    if (!$name) respondError('Name is required');

    $types = readJson('service_types.json');

    if ($parent) {
        // Detect level by prefix: sst_ = add service under subtype
        if (strpos($parent, 'sst_') === 0) {
            $email_to = filterEmails((array)($body['email_to'] ?? []));
            $email_cc = filterEmails((array)($body['email_cc'] ?? []));

            foreach ($types as &$t) {
                foreach ($t['subtypes'] as &$s) {
                    if ($s['id'] !== $parent) continue;
                    if (!isset($s['services'])) $s['services'] = [];
                    $maxOrder = 0;
                    foreach ($s['services'] as $svc) {
                        if (($svc['order'] ?? 0) > $maxOrder) $maxOrder = $svc['order'];
                    }
                    $newSvc = [
                        'id'       => genId('sv'),
                        'name'     => $name,
                        'email_to' => $email_to,
                        'email_cc' => $email_cc,
                        'order'    => $maxOrder + 1
                    ];
                    $s['services'][] = $newSvc;
                    writeJson('service_types.json', $types);
                    logActivity('servicetype_service_add', ['name' => $name, 'parent_id' => $parent], $payload['sub'], $payload['name']);
                    respondOk($newSvc, 'Service added');
                }
                unset($s);
            }
            unset($t);
            respondError('Parent subtype not found', 404);
        }

        // st_ prefix (or any other) = add subtype under service type
        $emails = filterEmails((array)($body['emails'] ?? []));
        foreach ($types as &$t) {
            if ($t['id'] !== $parent) continue;
            $maxOrder = 0;
            foreach ($t['subtypes'] as $s) {
                if (($s['order'] ?? 0) > $maxOrder) $maxOrder = $s['order'];
            }
            $subtype = [
                'id'       => genId('sst'),
                'name'     => $name,
                'emails'   => $emails,
                'services' => [],
                'order'    => $maxOrder + 1
            ];
            $t['subtypes'][] = $subtype;
            writeJson('service_types.json', $types);
            logActivity('servicetype_subtype_add', ['name' => $name, 'parent_id' => $parent], $payload['sub'], $payload['name']);
            respondOk($subtype, 'Subtype added');
        }
        unset($t);
        respondError('Parent service type not found', 404);
    }

    // No parent — create top-level service type
    $maxOrder = 0;
    foreach ($types as $t) {
        if (($t['order'] ?? 0) > $maxOrder) $maxOrder = $t['order'];
    }
    $newType = [
        'id'       => genId('st'),
        'name'     => $name,
        'order'    => $maxOrder + 1,
        'subtypes' => []
    ];
    $types[] = $newType;
    writeJson('service_types.json', $types);
    logActivity('servicetype_create', ['id' => $newType['id'], 'name' => $name], $payload['sub'], $payload['name']);
    respondOk($newType, 'Service type created');
}

// PUT — update service type | subtype | service
if ($method === 'PUT') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    if (!$id) respondError('ID required');
    $body = getBody();
    $name = trim($body['name'] ?? '');
    if (!$name) respondError('Name is required');

    $types = readJson('service_types.json');
    $found = false;

    // 1st level: service types
    foreach ($types as &$t) {
        if ($t['id'] === $id) {
            $t['name'] = $name;
            $found = true;
            break;
        }
    }
    unset($t);

    // 2nd level: subtypes
    if (!$found) {
        $emails = array_key_exists('emails', $body)
            ? filterEmails((array)$body['emails'])
            : null;

        foreach ($types as &$t) {
            foreach ($t['subtypes'] as &$s) {
                if ($s['id'] !== $id) continue;
                $s['name'] = $name;
                if ($emails !== null) $s['emails'] = $emails;
                $found = true;
                break 2;
            }
            unset($s);
        }
        unset($t);
    }

    // 3rd level: services
    if (!$found) {
        $email_to = array_key_exists('email_to', $body) ? filterEmails((array)$body['email_to']) : null;
        $email_cc = array_key_exists('email_cc', $body) ? filterEmails((array)$body['email_cc']) : null;

        foreach ($types as &$t) {
            foreach ($t['subtypes'] as &$s) {
                if (empty($s['services'])) continue;
                foreach ($s['services'] as &$svc) {
                    if ($svc['id'] !== $id) continue;
                    $svc['name'] = $name;
                    if ($email_to !== null) $svc['email_to'] = $email_to;
                    if ($email_cc !== null) $svc['email_cc'] = $email_cc;
                    $found = true;
                    break 3;
                }
                unset($svc);
            }
            unset($s);
        }
        unset($t);
    }

    if (!$found) respondError('Not found', 404);
    writeJson('service_types.json', $types);
    logActivity('servicetype_rename', ['id' => $id, 'name' => $name], $payload['sub'], $payload['name']);
    respondOk(null, 'Updated successfully');
}

// DELETE — remove service type | subtype | service
if ($method === 'DELETE') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    if (!$id) respondError('ID required');

    $types = readJson('service_types.json');

    // 1st level: service type
    $filtered = array_values(array_filter($types, fn($t) => $t['id'] !== $id));
    if (count($filtered) < count($types)) {
        writeJson('service_types.json', $filtered);
        logActivity('servicetype_delete', ['id' => $id, 'kind' => 'service_type'], $payload['sub'], $payload['name']);
        respondOk(null, 'Service type deleted');
    }

    // 2nd level: subtype
    $found = false;
    foreach ($types as &$t) {
        $before = count($t['subtypes']);
        $t['subtypes'] = array_values(array_filter($t['subtypes'], fn($s) => $s['id'] !== $id));
        if (count($t['subtypes']) < $before) { $found = true; break; }
    }
    unset($t);

    if ($found) {
        writeJson('service_types.json', $types);
        logActivity('servicetype_delete', ['id' => $id, 'kind' => 'subtype'], $payload['sub'], $payload['name']);
        respondOk(null, 'Subtype deleted');
    }

    // 3rd level: service
    foreach ($types as &$t) {
        foreach ($t['subtypes'] as &$s) {
            if (!isset($s['services'])) continue;
            $before = count($s['services']);
            $s['services'] = array_values(array_filter($s['services'], fn($svc) => $svc['id'] !== $id));
            if (count($s['services']) < $before) { $found = true; break 2; }
        }
        unset($s);
    }
    unset($t);

    if (!$found) respondError('Not found', 404);
    writeJson('service_types.json', $types);
    logActivity('servicetype_delete', ['id' => $id, 'kind' => 'service'], $payload['sub'], $payload['name']);
    respondOk(null, 'Service deleted');
}

respondError('Method not allowed', 405);

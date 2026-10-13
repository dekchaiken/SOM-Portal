<?php
/**
 * MA Modules Config API
 * Manages module-level configuration for MA Services
 *
 * GET    — list all modules
 * POST   — add (action=add) or update (action=update) a module
 * DELETE — delete a non-builtin module
 */

require_once __DIR__ . '/../helpers.php';
requireAuth();

// SM-shared: all teams read from sm/{file}. Writes are SM-only.
$modulesFile = _teamDataPath('ma-modules.json', $GLOBALS['_current_team'] ?? null);
$typesFile   = _teamDataPath('ma-types.json',   $GLOBALS['_current_team'] ?? null);

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'OPTIONS') {
    requireSmForShared();
}

/* ─── Defaults ─────────────────────────────────────── */
$defaultModules = [
    [
        'id'      => 'usecases',
        'name'    => 'MA Usecases',
        'desc'    => 'Manual Action Services',
        'icon'    => 'MA',
        'theme'   => 'amber',
        'enabled' => true,
        'order'   => 0,
        'builtin' => true,
        'status'  => 'active',
    ],
    [
        'id'      => 'cutoffs',
        'name'    => 'Cut-off Services',
        'desc'    => 'Cut-off Time Services',
        'icon'    => 'CO',
        'theme'   => 'blue',
        'enabled' => true,
        'order'   => 1,
        'builtin' => true,
        'status'  => 'active',
    ],
];

/* ─── Helpers ─────────────────────────────────────── */
function readModules($file, $defaults) {
    if (!file_exists($file)) {
        return ['modules' => $defaults];
    }
    $data = json_decode(file_get_contents($file), true);
    return $data ?: ['modules' => $defaults];
}

function writeModules($file, $data) {
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function makeId($name) {
    return preg_replace('/[^a-z0-9_]/', '_', strtolower(trim($name)));
}

/* ─── GET ─────────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $data    = readModules($modulesFile, $defaultModules);
    $modules = $data['modules'];

    // Attach type counts from ma-types.json
    $typesRaw  = file_exists($typesFile) ? json_decode(file_get_contents($typesFile), true) : [];
    $svcTypes  = $typesRaw['service_types'] ?? [];
    $siteTypes = $typesRaw['site_types'] ?? [];

    foreach ($modules as &$m) {
        if ($m['id'] === 'usecases') {
            $m['types']     = array_column($svcTypes, 'name');
            $m['type_data'] = array_map(fn($t) => [
                'name'  => $t['name'],
                'color' => $t['color'] ?? 'gray',
            ], $svcTypes);
        } elseif ($m['id'] === 'cutoffs') {
            $m['types']     = array_column($siteTypes, 'name');
            $m['type_data'] = array_map(fn($t) => [
                'name'  => $t['name'],
                'color' => $t['color'] ?? 'gray',
            ], $siteTypes);
        } else {
            $names  = $m['types'] ?? [];
            $colors = $m['type_colors'] ?? [];
            $m['types']     = $names;
            $m['type_data'] = array_map(fn($n) => [
                'name'  => $n,
                'color' => $colors[$n] ?? 'gray',
            ], $names);
        }
    }
    unset($m);

    usort($modules, fn($a, $b) => (int)($a['order'] ?? 99) - (int)($b['order'] ?? 99));

    echo json_encode(['success' => true, 'data' => $modules]);
    exit;
}

/* ─── POST ────────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input  = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $input['action'] ?? 'add';
    $data   = readModules($modulesFile, $defaultModules);

    /* Add new module */
    if ($action === 'add') {
        $name = trim($input['name'] ?? '');
        if (!$name) {
            echo json_encode(['success' => false, 'message' => 'Module name is required']);
            exit;
        }
        $id = makeId($name);
        foreach ($data['modules'] as $m) {
            if ($m['id'] === $id) {
                echo json_encode(['success' => false, 'message' => "Module ID '{$id}' already exists"]);
                exit;
            }
        }
        $data['modules'][] = [
            'id'      => $id,
            'name'    => $name,
            'desc'    => trim($input['desc'] ?? ''),
            'icon'    => strtoupper(substr($name, 0, 2)),
            'theme'   => $input['theme'] ?? 'orange',
            'enabled' => true,
            'order'   => count($data['modules']),
            'builtin' => false,
            'status'  => 'draft',
        ];
        writeModules($modulesFile, $data);
        echo json_encode(['success' => true]);
        exit;
    }

    /* Add sub-type to a custom module */
    if ($action === 'add_type') {
        $id    = $input['id']    ?? '';
        $type  = trim($input['type']  ?? '');
        $color = $input['color'] ?? 'gray';
        if (!$id || !$type) { echo json_encode(['success' => false, 'message' => 'id and type required']); exit; }
        $found = false;
        foreach ($data['modules'] as &$m) {
            if ($m['id'] === $id) {
                $m['types'] = $m['types'] ?? [];
                if (!in_array($type, $m['types'])) $m['types'][] = $type;
                $m['type_colors'] = $m['type_colors'] ?? [];
                $m['type_colors'][$type] = $color;
                $found = true; break;
            }
        }
        unset($m);
        if (!$found) { echo json_encode(['success' => false, 'message' => 'Module not found']); exit; }
        writeModules($modulesFile, $data);
        echo json_encode(['success' => true]);
        exit;
    }

    /* Rename/recolor sub-type in a custom module */
    if ($action === 'update_type') {
        $id      = $input['id']       ?? '';
        $oldType = trim($input['old_type'] ?? '');
        $newType = trim($input['type']     ?? '');
        $color   = $input['color'] ?? null;
        if (!$id || !$oldType || !$newType) { echo json_encode(['success' => false, 'message' => 'id, old_type and type required']); exit; }
        $found = false;
        foreach ($data['modules'] as &$m) {
            if ($m['id'] === $id) {
                $m['types'] = $m['types'] ?? [];
                $idx = array_search($oldType, $m['types']);
                if ($idx !== false) $m['types'][$idx] = $newType;
                $m['type_colors'] = $m['type_colors'] ?? [];
                $oldColor = $m['type_colors'][$oldType] ?? 'gray';
                unset($m['type_colors'][$oldType]);
                $m['type_colors'][$newType] = $color ?? $oldColor;
                $found = true; break;
            }
        }
        unset($m);
        if (!$found) { echo json_encode(['success' => false, 'message' => 'Module not found']); exit; }
        writeModules($modulesFile, $data);
        echo json_encode(['success' => true]);
        exit;
    }

    /* Delete sub-type from a custom module */
    if ($action === 'delete_type') {
        $id   = $input['id']   ?? '';
        $type = $input['type'] ?? '';
        if (!$id || !$type) { echo json_encode(['success' => false, 'message' => 'id and type required']); exit; }
        foreach ($data['modules'] as &$m) {
            if ($m['id'] === $id) {
                $m['types'] = array_values(array_filter($m['types'] ?? [], fn($t) => $t !== $type));
                unset($m['type_colors'][$type]);
                break;
            }
        }
        unset($m);
        writeModules($modulesFile, $data);
        echo json_encode(['success' => true]);
        exit;
    }

    /* Update existing module */
    if ($action === 'update') {
        $id = $input['id'] ?? '';
        $found = false;
        foreach ($data['modules'] as &$m) {
            if ($m['id'] === $id) {
                if (isset($input['name']))    $m['name']    = trim($input['name']);
                if (isset($input['desc']))    $m['desc']    = trim($input['desc']);
                if (isset($input['icon']))    $m['icon']    = strtoupper(substr(trim($input['icon']), 0, 4));
                if (isset($input['theme']))   $m['theme']   = $input['theme'];
                if (isset($input['enabled'])) $m['enabled'] = (bool)$input['enabled'];
                $found = true;
                break;
            }
        }
        unset($m);
        if (!$found) { echo json_encode(['success' => false, 'message' => 'Module not found']); exit; }
        writeModules($modulesFile, $data);
        echo json_encode(['success' => true]);
        exit;
    }

    /* Toggle enabled */
    if ($action === 'toggle') {
        $id = $input['id'] ?? '';
        foreach ($data['modules'] as &$m) {
            if ($m['id'] === $id) {
                $m['enabled'] = !($m['enabled'] ?? true);
                break;
            }
        }
        unset($m);
        writeModules($modulesFile, $data);
        echo json_encode(['success' => true]);
        exit;
    }

    /* Reorder */
    if ($action === 'reorder') {
        $orders = $input['orders'] ?? []; // { id: newOrder }
        foreach ($data['modules'] as &$m) {
            if (isset($orders[$m['id']])) {
                $m['order'] = (int)$orders[$m['id']];
            }
        }
        unset($m);
        writeModules($modulesFile, $data);
        echo json_encode(['success' => true]);
        exit;
    }

    echo json_encode(['success' => false, 'message' => 'Unknown action']);
    exit;
}

/* ─── DELETE ──────────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $id    = $input['id'] ?? ($_GET['id'] ?? '');

    $data  = readModules($modulesFile, $defaultModules);

    // Find module and check builtin
    $target = null;
    foreach ($data['modules'] as $m) {
        if ($m['id'] === $id) { $target = $m; break; }
    }

    if (!$target) {
        echo json_encode(['success' => false, 'message' => 'Module not found']);
        exit;
    }
    if (!empty($target['builtin'])) {
        echo json_encode(['success' => false, 'message' => 'Built-in modules cannot be deleted']);
        exit;
    }

    $data['modules'] = array_values(array_filter($data['modules'], fn($m) => $m['id'] !== $id));
    writeModules($modulesFile, $data);
    echo json_encode(['success' => true]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Method not allowed']);

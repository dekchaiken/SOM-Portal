<?php
/**
 * config.php — Admin: view or regenerate the n8n push key
 * GET  → { push_key, push_url }
 * POST → regenerate key
 */
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

function _uptimeCfgPath(): string { return DATA_DIR . 'uptime_config.json'; }

function _readCfg(): array {
    $p = _uptimeCfgPath();
    return file_exists($p) ? (json_decode(file_get_contents($p), true) ?? []) : [];
}

function _saveCfg(array $d): void {
    file_put_contents(_uptimeCfgPath(),
        json_encode($d, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
}

function getOrCreateKey(): string {
    $cfg = _readCfg();
    if (empty($cfg['push_key'])) {
        $cfg['push_key'] = bin2hex(random_bytes(24));
        _saveCfg($cfg);
    }
    return $cfg['push_key'];
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    respondOk(['push_key' => getOrCreateKey()]);
}

if ($method === 'POST') {
    $cfg = _readCfg();
    $cfg['push_key'] = bin2hex(random_bytes(24));
    _saveCfg($cfg);
    respondOk(['push_key' => $cfg['push_key']], 'Key regenerated');
}

respondError('Method not allowed', 405);

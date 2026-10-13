<?php
// DELETE (or POST) /api/alerts/delete.php   body: { id }
// Removes a rule + its state entry (so re-creating with same threshold
// doesn't inherit a stale "firing" state).
require_once __DIR__ . '/_lib.php';
requireAuth();
requireSmForShared();

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$id   = trim((string)($body['id'] ?? $_GET['id'] ?? ''));
if ($id === '') respondError('id required', 400);

$rules = array_values(array_filter(alertsLoadRules(), fn($r) => ($r['id'] ?? '') !== $id));
alertsSaveRules($rules);

$state = alertsLoadState();
unset($state[$id]);
alertsSaveState($state);

respondOk(['deleted' => $id]);

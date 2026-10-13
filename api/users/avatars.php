<?php
// Public user info endpoint — returns id, name, avatar_url for all users
// Any authenticated user can call this (used by board.html to show author avatars)
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respondError('Method not allowed', 405);
}

$users  = readJson('users.json');
$public = array_values(array_map(fn($u) => [
    'id'         => $u['id'],
    'name'       => $u['name'],
    'avatar_url' => $u['avatar_url'] ?? ''
], $users));

respondOk($public);

<?php
/**
 * Multi-Team Phase 1 Migration Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Run ONCE via CLI or browser (dev only). Safe to re-run — uses idempotent logic.
 *
 * What this does:
 *   1. Adds "team": "sm" to every existing user that has no team field
 *   2. Creates the super_admin user if it doesn't already exist
 *   3. Reports how many users were updated
 *
 * Usage (CLI):
 *   php api/dev/migrate-multiteam-p1.php
 *
 * Usage (browser, dev server only):
 *   http://localhost:8000/api/dev/migrate-multiteam-p1.php?key=MIGRATE_NOW
 *
 * DELETE this file after running successfully in production.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Safety guard — browser must pass ?key=MIGRATE_NOW ──────────────────────
if (PHP_SAPI !== 'cli') {
    $key = $_GET['key'] ?? '';
    if ($key !== 'MIGRATE_NOW') {
        http_response_code(403);
        die(json_encode(['error' => 'Pass ?key=MIGRATE_NOW to run this script via browser']));
    }
}

// Bootstrap — load helpers but skip the ensureAdminExists auto-run side-effect
// We include config directly so we can use DATA_DIR and helpers.
require_once __DIR__ . '/../config.php';

header('Content-Type: text/plain; charset=utf-8');

$results = [];
$errors  = [];

// ── Step 1: Read users.json ──────────────────────────────────────────────────
$usersPath = DATA_DIR . 'users.json';
if (!file_exists($usersPath)) {
    die("[ERROR] data/users.json not found. Nothing to migrate.\n");
}

$users = json_decode(file_get_contents($usersPath), true) ?? [];
if (empty($users)) {
    die("[INFO] users.json is empty. Nothing to migrate.\n");
}

echo "Found " . count($users) . " users.\n\n";

// ── Step 2: Add "team": "sm" to users without a team field ──────────────────
$updatedCount = 0;
$skippedCount = 0;
foreach ($users as &$u) {
    if (!isset($u['team'])) {
        $u['team'] = 'sm';
        $updatedCount++;
        echo "[UPDATE] {$u['username']} ({$u['role']}) → team: sm\n";
    } else {
        $skippedCount++;
        echo "[SKIP]   {$u['username']} already has team: {$u['team']}\n";
    }
}
unset($u);

// ── Step 3: Check if super_admin already exists ──────────────────────────────
$superExists = false;
foreach ($users as $u) {
    if ($u['role'] === 'super_admin') {
        $superExists = true;
        echo "\n[INFO] super_admin already exists: {$u['username']} (id: {$u['id']})\n";
        break;
    }
}

// ── Step 4: Create super_admin user if not found ─────────────────────────────
$generatedPassword = null;
if (!$superExists) {
    // Generate a secure random password
    $rawPassword       = 'SAdmin@' . strtoupper(bin2hex(random_bytes(4))) . '!';
    $generatedPassword = $rawPassword;

    $superAdmin = [
        'id'                  => 'usr_superadmin001',
        'name'                => 'Super Admin',
        'username'            => 'superadmin',
        'email'               => 'superadmin@system.local',
        'role'                => 'super_admin',
        'team'                => null,
        'password'            => password_hash($rawPassword, PASSWORD_BCRYPT, ['cost' => 10]),
        'password_history'    => [],
        'password_changed_at' => date('c'),
        'password_expired'    => false,
        'must_reset_password' => true, // force change on first login
        'first_login'         => true,
        'schedule_include'    => false,
        'created_at'          => date('c'),
        'created_by'          => 'system_migration',
        'nickname'            => 'SA',
        'avatar_url'          => '',
        'permissions'         => [],
    ];

    $users[] = $superAdmin;
    echo "\n[CREATE] super_admin user created: username=superadmin\n";
}

// ── Step 5: Write back users.json ─────────────────────────────────────────────
$fp = fopen($usersPath, 'c+');
if (!$fp) {
    die("[ERROR] Cannot open users.json for writing.\n");
}

$written = false;
if (flock($fp, LOCK_EX)) {
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    flock($fp, LOCK_UN);
    $written = true;
}
fclose($fp);

if (!$written) {
    die("[ERROR] Failed to acquire file lock on users.json.\n");
}

// ── Step 6: Verify teams.json exists ─────────────────────────────────────────
$teamsPath = DATA_DIR . 'teams.json';
if (file_exists($teamsPath)) {
    $teams = json_decode(file_get_contents($teamsPath), true) ?? [];
    echo "\n[OK] data/teams.json found with " . count($teams) . " team(s):\n";
    foreach ($teams as $t) {
        $featureCount = count($t['features'] ?? []);
        echo "     • {$t['slug']} ({$t['name']}) — {$featureCount} features\n";
    }
} else {
    echo "\n[WARN] data/teams.json not found. Create it before proceeding.\n";
}

// ── Summary ───────────────────────────────────────────────────────────────────
echo "\n";
echo "═══════════════════════════════════════════════════════\n";
echo " Migration Complete\n";
echo "═══════════════════════════════════════════════════════\n";
echo " Users updated (team → sm): {$updatedCount}\n";
echo " Users skipped (already set): {$skippedCount}\n";
echo " Total users in file: " . count($users) . "\n";

if ($generatedPassword) {
    echo "\n ★ super_admin created:\n";
    echo "   username : superadmin\n";
    echo "   password : {$generatedPassword}\n";
    echo "   ⚠ must_reset_password = true → change on first login\n";
    echo "\n   SAVE THIS PASSWORD — it will not be shown again.\n";
} else {
    echo "\n super_admin: already existed (no new user created)\n";
}

echo "═══════════════════════════════════════════════════════\n";
echo "\nDelete this file (api/dev/migrate-multiteam-p1.php) after verifying.\n";

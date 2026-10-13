<?php
/**
 * mail-config/index.php
 * GET → return mail config (admin only)
 * PUT → update mail config (admin only)
 *
 * Config keys: smtp_host, smtp_port, smtp_encryption, smtp_user, smtp_password,
 *              from_name, from_email, global_cc[], email_signature
 */
require_once __DIR__ . '/../helpers.php';

$method  = $_SERVER['REQUEST_METHOD'];
$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

const MAIL_FILE = 'mail_config.json';

$ALLOWED_KEYS = [
    'smtp_host', 'smtp_port', 'smtp_encryption',
    'smtp_user', 'smtp_password',
    'from_name', 'from_email',
    'global_cc', 'email_signature',
    'email_brand_title', 'email_brand_colors',
    'email_footer_title', 'email_footer_contact', 'email_footer_address', 'email_footer_website',
    'email_brand_sizes',
    'email_footer_style',
    'email_header_style',
    'email_public_base_url',
    'email_header_tw_bg',
    'email_header_tw_text',
    'email_header_tw_accent',
];

// Footer/header styles allowed for every team.
const _FT_STYLES_ALL = ['classic'];
// Extra footer/header styles reserved for the SM team only.
const _FT_STYLES_SM  = ['typewriter'];

// ── GET ────────────────────────────────────────────────────
if ($method === 'GET') {
    $cfg = readJson(MAIL_FILE);
    // Mask password
    if (!empty($cfg['smtp_password'])) {
        $cfg['smtp_password_set'] = true;
        $cfg['smtp_password']     = '';  // never expose
    } else {
        $cfg['smtp_password_set'] = false;
    }
    // Advertise which footer styles the UI may offer for this team.
    $team = $GLOBALS['_current_team'] ?? ($payload['team'] ?? '');
    $cfg['_footer_styles_available'] = $team === 'sm'
        ? array_merge(_FT_STYLES_ALL, _FT_STYLES_SM)
        : _FT_STYLES_ALL;
    if (empty($cfg['email_footer_style'])) $cfg['email_footer_style'] = 'classic';
    if (empty($cfg['email_header_style'])) $cfg['email_header_style'] = 'classic';
    respondOk($cfg);
}

// ── PUT ────────────────────────────────────────────────────
if ($method === 'PUT') {
    requireCsrf();
    $body = getBody();
    $cfg  = readJson(MAIL_FILE);

    foreach ($ALLOWED_KEYS as $key) {
        if (!array_key_exists($key, $body)) continue;

        if ($key === 'global_cc') {
            $cfg['global_cc'] = array_values(array_filter(
                array_map('trim', (array)$body['global_cc']),
                fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)
            ));
        } elseif ($key === 'email_brand_colors') {
            // Accept exactly 4 hex color strings
            $colors = array_values(array_filter(
                array_map('trim', (array)$body['email_brand_colors']),
                fn($c) => preg_match('/^#[0-9a-fA-F]{6}$/', $c)
            ));
            if (count($colors) === 4) $cfg['email_brand_colors'] = $colors;
        } elseif ($key === 'email_brand_sizes') {
            // Validate numeric size settings; keep existing if invalid
            $sz = is_array($body['email_brand_sizes']) ? $body['email_brand_sizes'] : [];
            $numKeys = ['hdr_pad','hdr_title','hdr_sub','divider','ft_pad','ft_title','ft_contact','ft_addr'];
            $saved = [];
            foreach ($numKeys as $k) {
                if (isset($sz[$k]) && is_numeric($sz[$k])) {
                    $saved[$k] = round((float)$sz[$k], 1);
                }
            }
            if (isset($sz['ft_bg']) && preg_match('/^#[0-9a-fA-F]{3,6}$/', $sz['ft_bg'])) {
                $saved['ft_bg'] = $sz['ft_bg'];
            }
            if (!empty($saved)) $cfg['email_brand_sizes'] = array_merge($cfg['email_brand_sizes'] ?? [], $saved);
        } elseif ($key === 'smtp_port') {
            $cfg['smtp_port'] = (int)$body['smtp_port'];
        } elseif ($key === 'smtp_password') {
            // Only update password if a new non-empty value is provided
            if (trim($body['smtp_password']) !== '') {
                $cfg['smtp_password'] = trim($body['smtp_password']);
            }
        } elseif ($key === 'smtp_encryption') {
            $enc = $body['smtp_encryption'];
            $cfg['smtp_encryption'] = in_array($enc, ['none','tls','ssl']) ? $enc : 'tls';
        } elseif (in_array($key, ['email_header_tw_bg','email_header_tw_text','email_header_tw_accent'], true)) {
            $hex = trim((string)$body[$key]);
            if ($hex === '' || preg_match('/^#[0-9a-fA-F]{6}$/', $hex)) {
                $cfg[$key] = $hex;
            }
        } elseif ($key === 'email_footer_style' || $key === 'email_header_style') {
            $style   = trim((string)$body[$key]);
            $team    = $GLOBALS['_current_team'] ?? ($payload['team'] ?? '');
            $allowed = $team === 'sm'
                ? array_merge(_FT_STYLES_ALL, _FT_STYLES_SM)
                : _FT_STYLES_ALL;
            if (!in_array($style, $allowed, true)) {
                // Silently coerce unauthorized style back to 'classic' rather than 500.
                $style = 'classic';
            }
            $cfg[$key] = $style;
        } else {
            $cfg[$key] = trim($body[$key] ?? '');
        }
    }

    writeJson(MAIL_FILE, $cfg);
    logActivity('mail_config_updated', [
        'keys' => implode(',', array_keys(array_filter($body, fn($v, $k) => $k !== 'smtp_password', ARRAY_FILTER_USE_BOTH))),
    ], $payload['sub'], $payload['name'] ?? '');

    // Return without exposing password
    $cfg['smtp_password_set'] = !empty($cfg['smtp_password']);
    $cfg['smtp_password']     = '';
    respondOk($cfg);
}

respondError('Method not allowed', 405);

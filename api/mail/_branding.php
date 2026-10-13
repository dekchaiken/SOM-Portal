<?php
/**
 * Bauhaus-D email frame — used by every system email.
 *
 *   buildBrandedEmail($innerRows, $subject, $cfg, $useBrand=true): string
 *     $innerRows  raw <tr>...</tr> rows that will sit inside the main 600px table
 *     $subject    title (used in <title> + preheader)
 *     $cfg        mail_config.json contents (controls footer text)
 *     $useBrand   if false → returns the inner HTML wrapped in a minimal frame
 *                 only (no footer, no fonts) — used for plain admin emails
 *
 * Fonts loaded from Google Fonts:
 *   - JetBrains Mono (English / labels / numbers)
 *   - IBM Plex Sans Thai (Thai body text — auto-picked by the browser
 *     when JetBrains Mono lacks Thai glyphs, via the fallback chain)
 *
 * Email-client note: Gmail strips <link rel=stylesheet> in some cases, but
 * the inline font-family fallback chain still produces readable output
 * (defaults to system mono/sans). Apple Mail + iOS Mail render fonts fully.
 */

/**
 * Return the <tr>…</tr> footer block for the current email frame, picking the
 * variant declared by $cfg['email_footer_style'] ('classic' or 'typewriter').
 *
 * The Typewriter variant is the SM-team-only "SM_ | Service Monitoring" layout —
 * static representation of Concept 1 from admin/email-logo-mockups.html. It's
 * gated on the frontend (only SM sees the option) and on the backend (only SM
 * teams can persist it via mail-config API), so any other team hitting this
 * path with 'typewriter' still gets a valid render — but that state can only
 * be produced by SM-admin edits.
 */
function _footerRowForStyle(array $cfg, string $ftTitle, string $ftContactLinked, string $ftAddress, string $webHref, string $webDsp): string
{
    $style = trim((string)($cfg['email_footer_style'] ?? 'classic'));
    if ($style === 'typewriter') {
        return _footerRowTypewriter($cfg, $ftTitle, $ftContactLinked, $ftAddress, $webHref, $webDsp);
    }
    return _footerRowClassic($ftTitle, $ftContactLinked, $ftAddress, $webHref, $webDsp);
}

/**
 * Classic Bauhaus footer — the original dark block with orange bar accent.
 * Unchanged from the original inline HTML.
 */
function _footerRowClassic(string $ftTitle, string $ftContactLinked, string $ftAddress, string $webHref, string $webDsp): string
{
    return <<<FTR
<tr><td style="background:#111;color:#bbb;padding:24px 32px;font-family:'JetBrains Mono','IBM Plex Sans Thai','Segoe UI',sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:top">
      <div style="color:#F26419;font-weight:800;letter-spacing:.2em;font-size:12px">SMC</div>
      <div style="color:#cbd5e1;font-size:11px;margin-top:8px;font-weight:600;letter-spacing:.02em">{$ftTitle}</div>
      <div style="color:#888;font-size:10.5px;margin-top:6px;line-height:1.7">{$ftContactLinked}</div>
      <div style="color:#666;font-size:10px;margin-top:6px;line-height:1.7">{$ftAddress}</div>
      <div style="color:#666;font-size:10px;margin-top:4px">
        <a href="{$webHref}" style="color:#F26419;text-decoration:none">{$webDsp}</a>
      </div>
    </td>
    <td align="right" style="font-size:46px;color:#F26419;font-weight:900;line-height:1;vertical-align:top;padding-left:14px">▌</td>
  </tr></table>
</td></tr>
FTR;
}

/**
 * Typewriter footer (SM team only) — static representation of the Concept 1
 * animated logo: big "SM_" cursor on the left, orange vertical bar, "Service
 * Monitoring" wordmark on the right, then a terminal-style contact block below.
 *
 * Static (no CSS animation) because email clients strip <style>/animations —
 * only the visual identity carries over. Same colors as buildBrandedEmail.
 */
/**
 * Typewriter header (SM team only) — terminal-window aesthetic that pairs with
 * the Typewriter footer. Two-row layout:
 *   1) A macOS-style title bar strip (traffic-light dots + prompt path + tag)
 *   2) A dark hero row with the brand title in JetBrains Mono + orange accent
 *
 * Emits <tr>…</tr> rows that slot directly into the outer gradient-email table.
 */
/**
 * Shift a hex color's luminance up (if dark) or down (if light) by a small
 * amount — used to derive the terminal title-bar strip color from the main
 * header background so the two bands read as separate but coherent surfaces.
 */
function _shiftLuma(string $hex, int $amount): string
{
    if (!preg_match('/^#[0-9a-fA-F]{6}$/', $hex)) return $hex;
    $r = hexdec(substr($hex, 1, 2));
    $g = hexdec(substr($hex, 3, 2));
    $b = hexdec(substr($hex, 5, 2));
    $luma = ($r * 299 + $g * 587 + $b * 114) / 1000;
    $delta = $luma < 128 ? $amount : -$amount;
    $clamp = fn(int $v) => max(0, min(255, $v + $delta));
    return sprintf('#%02x%02x%02x', $clamp($r), $clamp($g), $clamp($b));
}

function _headerRowTypewriter(array $cfg, string $brandTitleEsc, float $hdrPad, float $hdrTitleSz): string
{
    // Palette (defaults = dark Bauhaus). Admin can override per-team via mail-config.
    $bg     = trim((string)($cfg['email_header_tw_bg']     ?? '')) ?: '#111111';
    $text   = trim((string)($cfg['email_header_tw_text']   ?? '')) ?: '#f4f1eb';
    $accent = trim((string)($cfg['email_header_tw_accent'] ?? '')) ?: '#F26419';
    $barBg  = _shiftLuma($bg, 12);   // title-bar strip = bg shifted toward middle

    return <<<HDR
<!-- Terminal title bar (macOS traffic-light dots only) -->
<tr><td style="background:{$barBg};padding:9px 16px">
  <span style="display:inline-block;width:11px;height:11px;background:#ff5f57;border-radius:50%;vertical-align:middle;margin-right:6px"></span>
  <span style="display:inline-block;width:11px;height:11px;background:#febc2e;border-radius:50%;vertical-align:middle;margin-right:6px"></span>
  <span style="display:inline-block;width:11px;height:11px;background:#28c840;border-radius:50%;vertical-align:middle"></span>
</td></tr>

<!-- Main header — palette-driven bg + title text + accent bar -->
<tr><td style="padding:{$hdrPad}px 28px;background:{$bg};color:{$text};font-family:'JetBrains Mono','IBM Plex Sans Thai',monospace">
  <div style="font-size:{$hdrTitleSz}px;font-weight:800;color:{$text};line-height:1.25;letter-spacing:-.01em;font-family:'JetBrains Mono','IBM Plex Sans Thai',monospace">{$brandTitleEsc}</div>
  <div style="height:4px;width:72px;background:{$accent};margin-top:16px"></div>
</td></tr>
HDR;
}

function _footerRowTypewriter(array $cfg, string $ftTitle, string $ftContactLinked, string $ftAddress, string $webHref, string $webDsp): string
{
    // Prefer an external URL (no attachment chip in Gmail); fall back to CID
    // inline attachment when no public base URL is configured.
    $publicUrl = trim((string)($cfg['email_public_base_url'] ?? ''));
    if ($publicUrl !== '') {
        $imgSrc = htmlspecialchars(rtrim($publicUrl, '/') . '/uploads/sm-logo-typewriter.gif', ENT_QUOTES, 'UTF-8');
    } else {
        $imgSrc = 'cid:sm-logo-typewriter';
    }

    return <<<FTR
<tr><td style="background:#111;color:#e2e8f0;padding:22px 28px;font-family:'JetBrains Mono','IBM Plex Sans Thai','Segoe UI',sans-serif">
  <!-- Wordmark row: animated GIF (SM_ | Service Monitoring) + ONLINE badge -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle">
      <img src="{$imgSrc}" width="300" height="85" alt="SM · Service Monitoring"
           style="display:block;border:0;outline:none;max-width:300px;height:auto">
    </td>
    <td align="right" style="vertical-align:middle;padding-left:12px">
      <span style="display:inline-block;background:#22c55e;color:#111;padding:4px 10px;font-size:9.5px;font-weight:800;letter-spacing:.12em;border-radius:2px;font-family:'JetBrains Mono',monospace">● ONLINE</span>
    </td>
  </tr></table>

  <!-- Divider -->
  <div style="height:1px;background:#333;margin:14px 0"></div>

  <!-- Terminal-style contact block -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:'JetBrains Mono',monospace">
    <tr>
      <td style="vertical-align:top;font-size:11px;line-height:1.9">
        <div><span style="color:#F26419;font-weight:800">▸ MAIL &nbsp;</span> <span style="color:#e2e8f0">{$ftContactLinked}</span></div>
        <div><span style="color:#F26419;font-weight:800">▸ OFC &nbsp;&nbsp;</span> <span style="color:#94a3b8">{$ftAddress}</span></div>
        <div><span style="color:#F26419;font-weight:800">▸ WEB &nbsp;&nbsp;</span> <a href="{$webHref}" style="color:#fcd34d;text-decoration:none">{$webDsp}</a></div>
        <div style="margin-top:8px;color:#666;font-size:10px;font-family:'IBM Plex Sans Thai','JetBrains Mono',sans-serif">— {$ftTitle}</div>
      </td>
    </tr>
  </table>
</td></tr>
FTR;
}

function buildBrandedEmail(string $innerRows, string $subject, array $cfg, bool $useBrand = true): string
{
    $subjectEsc = htmlspecialchars($subject, ENT_QUOTES, 'UTF-8');

    // ── Plain mode (no branding) — for admin-composed generic emails ──
    if (!$useBrand) {
        return <<<HTML
<!doctype html><html><head><meta charset="utf-8"><title>{$subjectEsc}</title></head>
<body style="margin:0;padding:20px;font-family:'JetBrains Mono','IBM Plex Sans Thai',-apple-system,sans-serif;font-size:13px;line-height:1.65;color:#1a1a1a">
{$innerRows}
</body></html>
HTML;
    }

    // ── Footer content from mail_config.json (with safe fallbacks) ──
    $ft = function (string $key, string $default) use ($cfg): string {
        $v = trim($cfg[$key] ?? '');
        return htmlspecialchars($v !== '' ? $v : $default, ENT_QUOTES, 'UTF-8');
    };
    $ftTitle   = $ft('email_footer_title',   'Service Monitoring Center (SMC)');
    $ftContact = $ft('email_footer_contact', 'Service Management Center, Ascend Money  |  sm@ascendcorp.com  |  +66 91 6969 885');
    $ftAddress = $ft('email_footer_address', '101 True Digital Park, Phoenix Building 7th Floor, Sukhumvit Road, Bang Chak, Phra Khanong, Bangkok 10260');
    $ftWebsite = $ft('email_footer_website', 'www.ascendmoneygroup.com');

    // Linkify mailto inside contact string
    $ftContactLinked = preg_replace_callback(
        '/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/',
        fn($m) => '<a href="mailto:' . $m[1] . '" style="color:#F26419;text-decoration:none">' . $m[1] . '</a>',
        $ftContact
    );
    // Visual separator pipes → padded
    $ftContactLinked = str_replace(' | ', ' &nbsp;|&nbsp; ', $ftContactLinked);

    $webHref = preg_match('#^https?://#', $ftWebsite) ? $ftWebsite : 'http://' . $ftWebsite;
    $webDsp  = preg_replace('#^https?://#', '', $ftWebsite);

    $preheader = '<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4f1eb;opacity:0">'
               . $subjectEsc . '</div>';

    // ── Footer row — style-aware: Bauhaus (default) or Typewriter (SM only) ──
    $footerRow = _footerRowForStyle($cfg, $ftTitle, $ftContactLinked, $ftAddress, $webHref, $webDsp);

    return <<<HTML
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>{$subjectEsc}</title>

  <!-- Two delivery paths for the web fonts:
       1. <link rel="stylesheet">  → Apple Mail, iOS Mail, some Outlook web
       2. @import inside <style>   → Gmail Web (strips <link> but keeps @import)
       Either succeeds, fonts load. If both fail (Outlook desktop), the inline
       fallback chain on every element keeps the design clean. -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&display=swap');
    /* Force the chain even if Gmail injects its own font CSS for messages */
    body, table, td, div, p, a, span, h1, h2, h3, strong {
      font-family: 'JetBrains Mono', 'IBM Plex Sans Thai', 'SF Mono', Menlo, Consolas, 'Sarabun', 'Noto Sans Thai', 'Segoe UI', Tahoma, sans-serif !important;
    }
  </style>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, div, p, h1 { font-family: Tahoma, 'Segoe UI', sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#fff;font-family:'JetBrains Mono','IBM Plex Sans Thai','SF Mono',Menlo,Consolas,'Sarabun','Noto Sans Thai','Segoe UI',Tahoma,sans-serif;color:#1a1a1a;-webkit-font-smoothing:antialiased">
{$preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;width:100%;border-collapse:collapse">
  <tr><td style="padding:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#fff;border-collapse:collapse">
{$innerRows}
{$footerRow}
    </table>
  </td></tr>
</table>
</body>
</html>
HTML;
}

/**
 * Gradient email frame — admin-configurable via admin/mail-config.html
 * (Branded Email Template section). Used by the user-composed email flow:
 *   - send-email.html  →  /api/mail/send.php
 *   - inbox.html       →  /api/inbox/send.php
 *
 * Reads from mail_config.json:
 *   email_brand_title         header title text
 *   email_brand_colors[4]     4 hex stops for gradient header + dividers
 *   email_brand_sizes{...}    hdr_pad, hdr_title, divider, ft_pad, ft_title,
 *                             ft_contact, ft_addr, ft_bg
 *   email_footer_title        dark footer yellow title
 *   email_footer_contact      contact line ("|" as separator, emails auto-linked)
 *   email_footer_address      gray address line
 *   email_footer_website      yellow website link
 *
 * Layout mirrors the Live Preview in admin/mail-config.html exactly:
 *   pastel gradient header → gradient divider → body → gradient divider → dark footer
 *
 * When $useBrand is false: returns the same minimal frame as buildBrandedEmail()
 * (no header/footer), so the existing useBranding=false UI checkbox keeps working.
 */
function buildGradientEmail(string $innerHtml, string $subject, array $cfg, bool $useBrand = true): string
{
    $subjectEsc = htmlspecialchars($subject, ENT_QUOTES, 'UTF-8');

    if (!$useBrand) {
        return <<<HTML
<!doctype html><html><head><meta charset="utf-8"><title>{$subjectEsc}</title></head>
<body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Sarabun','Noto Sans Thai',Tahoma,sans-serif;font-size:13px;line-height:1.65;color:#1e293b">
{$innerHtml}
</body></html>
HTML;
    }

    // ── Header title ─────────────────────────────────────────────────────
    $brandTitle = trim($cfg['email_brand_title'] ?? '') ?: 'TechOps · Service Monitoring Center';
    $brandTitleEsc = htmlspecialchars($brandTitle, ENT_QUOTES, 'UTF-8');

    // ── 4-stop gradient (validate, fallback to "warm" preset) ────────────
    $defaultColors = ['#fde047', '#fb923c', '#ec4899', '#a855f7'];
    $colors = (isset($cfg['email_brand_colors']) && is_array($cfg['email_brand_colors']) && count($cfg['email_brand_colors']) === 4)
        ? $cfg['email_brand_colors']
        : $defaultColors;
    foreach ($colors as $c) {
        if (!is_string($c) || !preg_match('/^#[0-9a-fA-F]{6}$/', $c)) { $colors = $defaultColors; break; }
    }
    $lighten = function (string $hex, float $r): string {
        $n = hexdec(ltrim($hex, '#'));
        $mix = fn(int $v) => (int)round($v + (255 - $v) * $r);
        return sprintf('#%02x%02x%02x', $mix(($n >> 16) & 255), $mix(($n >> 8) & 255), $mix($n & 255));
    };
    $pastel = array_map(fn($c) => $lighten($c, 0.78), $colors);
    $headerBg  = "linear-gradient(135deg, {$pastel[0]} 0%, {$pastel[1]} 35%, {$pastel[2]} 68%, {$pastel[3]} 100%)";
    $dividerBg = "linear-gradient(90deg, {$colors[0]} 0%, {$colors[1]} 35%, {$colors[2]} 70%, {$colors[3]} 100%)";
    // Solid-color fallbacks for Outlook (which ignores linear-gradient)
    $headerSolid  = $pastel[1];
    $dividerSolid = $colors[2];

    // ── Sizes ────────────────────────────────────────────────────────────
    $sz = is_array($cfg['email_brand_sizes'] ?? null) ? $cfg['email_brand_sizes'] : [];
    $hdrPad    = (float)($sz['hdr_pad']    ?? 44);
    $hdrTitle  = (float)($sz['hdr_title']  ?? 26);
    $divider   = max(1, (float)($sz['divider']    ?? 4));
    $ftPad     = (float)($sz['ft_pad']     ?? 30);
    $ftTitleSz = (float)($sz['ft_title']   ?? 18);
    $ftContSz  = (float)($sz['ft_contact'] ?? 11.5);
    $ftAddrSz  = (float)($sz['ft_addr']    ?? 11);
    $ftBg      = (isset($sz['ft_bg']) && is_string($sz['ft_bg']) && preg_match('/^#[0-9a-fA-F]{3,6}$/', $sz['ft_bg']))
                 ? $sz['ft_bg'] : '#0f172a';

    // ── Footer text (escape + sensible defaults) ─────────────────────────
    $ft = function (string $key, string $default) use ($cfg): string {
        $v = trim($cfg[$key] ?? '');
        return $v !== '' ? $v : $default;
    };
    $ftTitleText   = $ft('email_footer_title',   'Service Monitoring Center (SMC)');
    $ftContactText = $ft('email_footer_contact', 'Service Management Center, Ascend Money | M +66 91 6969 885 | sm@ascendcorp.com');
    $ftAddressText = $ft('email_footer_address', '101 True Digital Park, Phoenix Building 7th Floor, Sukhumvit Road, Bang Chak, Phra Khanong, Bangkok 10260');
    $ftWebsiteText = $ft('email_footer_website', 'www.ascendmoneygroup.com');

    $ftTitleEsc   = htmlspecialchars($ftTitleText, ENT_QUOTES, 'UTF-8');
    $ftAddressEsc = htmlspecialchars($ftAddressText, ENT_QUOTES, 'UTF-8');
    $webHref      = preg_match('#^https?://#', $ftWebsiteText) ? $ftWebsiteText : 'http://' . $ftWebsiteText;
    $webHrefEsc   = htmlspecialchars($webHref, ENT_QUOTES, 'UTF-8');
    $webDspEsc    = htmlspecialchars(preg_replace('#^https?://#', '', $ftWebsiteText), ENT_QUOTES, 'UTF-8');

    // Contact line: escape first, then auto-link emails (yellow) and pad pipes
    $contactHtml = htmlspecialchars($ftContactText, ENT_QUOTES, 'UTF-8');
    $contactHtml = preg_replace(
        '/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/',
        '<a href="mailto:$1" style="color:#fcd34d;text-decoration:none">$1</a>',
        $contactHtml
    );
    $contactHtml = str_replace(' | ', ' &nbsp;|&nbsp; ', $contactHtml);

    $preheader = '<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#fff;opacity:0">'
               . $subjectEsc . '</div>';

    // Build footer <tr>…</tr> — pick classic (centered gold) or typewriter (SM only).
    // Both branches emit a single row that slots into the outer table below.
    $style = trim((string)($cfg['email_footer_style'] ?? 'classic'));
    if ($style === 'typewriter') {
        // Reuse the Bauhaus-frame typewriter footer so the visual identity is
        // consistent across both email frames when SM opts in.
        $ftContactLinkedForTw = str_replace(' | ', ' &nbsp;|&nbsp; ',
            preg_replace(
                '/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/',
                '<a href="mailto:$1" style="color:#F26419;text-decoration:none">$1</a>',
                htmlspecialchars($ftContactText, ENT_QUOTES, 'UTF-8')
            )
        );
        $footerHtml = _footerRowTypewriter($cfg, $ftTitleEsc, $ftContactLinkedForTw, $ftAddressEsc, $webHrefEsc, $webDspEsc);
    } else {
        $footerHtml = <<<FTC
<tr><td align="center" style="padding:{$ftPad}px 28px;background:{$ftBg};text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Sarabun','Noto Sans Thai',Tahoma,sans-serif">
  <div style="font-size:{$ftTitleSz}px;font-weight:700;color:#fcd34d;margin-bottom:6px">{$ftTitleEsc}</div>
  <div style="font-size:{$ftContSz}px;color:#cbd5e1;line-height:1.7">{$contactHtml}</div>
  <div style="font-size:{$ftAddrSz}px;color:#94a3b8;line-height:1.7;margin-top:5px">{$ftAddressEsc}</div>
  <div style="font-size:{$ftAddrSz}px;margin-top:3px"><a href="{$webHrefEsc}" style="color:#fcd34d;text-decoration:none">{$webDspEsc}</a></div>
</td></tr>
FTC;
    }

    // Build header rows — pick classic (pastel gradient) or typewriter (terminal, SM only).
    $hdrStyle = trim((string)($cfg['email_header_style'] ?? 'classic'));
    if ($hdrStyle === 'typewriter') {
        $headerRows = _headerRowTypewriter($cfg, $brandTitleEsc, $hdrPad, $hdrTitle);
        // Solid accent-color divider matches the terminal aesthetic better than
        // the pastel gradient stripe; uses the same accent as the header bar.
        $twAccent = trim((string)($cfg['email_header_tw_accent'] ?? '')) ?: '#F26419';
        $topDivider = "<tr><td style=\"height:{$divider}px;line-height:{$divider}px;font-size:0;background:{$twAccent}\">&nbsp;</td></tr>";
    } else {
        $headerRows = <<<HDR
<!-- HEADER (pastel gradient) — full width -->
<tr><td style="padding:{$hdrPad}px 28px;background-color:{$headerSolid};background:{$headerBg}">
  <div style="font-size:{$hdrTitle}px;font-weight:700;color:#0f172a;line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Sarabun','Noto Sans Thai',Tahoma,sans-serif">{$brandTitleEsc}</div>
</td></tr>
HDR;
        $topDivider = "<tr><td style=\"height:{$divider}px;line-height:{$divider}px;font-size:0;background-color:{$dividerSolid};background:{$dividerBg}\">&nbsp;</td></tr>";
    }

    return <<<HTML
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>{$subjectEsc}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, div, p, h1 { font-family: Tahoma, 'Segoe UI', sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Sarabun','Noto Sans Thai',Tahoma,sans-serif;color:#1e293b;-webkit-font-smoothing:antialiased">
{$preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;width:100%;border-collapse:collapse">
  <!-- HEADER — style-aware (classic pastel gradient / typewriter terminal for SM only) -->
  {$headerRows}
  <!-- TOP DIVIDER — matches the chosen header aesthetic -->
  {$topDivider}
  <!-- BODY (user content) -->
  <tr><td style="padding:22px 28px;font-size:13px;color:#1e293b;line-height:1.65;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Sarabun','Noto Sans Thai',Tahoma,sans-serif">
    {$innerHtml}
  </td></tr>
  <!-- BOTTOM DIVIDER -->
  <tr><td style="height:{$divider}px;line-height:{$divider}px;font-size:0;background-color:{$dividerSolid};background:{$dividerBg}">&nbsp;</td></tr>
  <!-- FOOTER — style-aware (classic centered gold / typewriter for SM only) -->
  {$footerHtml}
</table>
</body>
</html>
HTML;
}

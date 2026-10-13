<?php
/**
 * IMAP helpers using a single persistent SSL socket connection.
 *
 * WHY: cURL opens a new TLS connection per request → listing 50 emails = 52 handshakes (~30s).
 *      A single stream_socket_client() connection lets us run all commands in one session (~2s).
 *
 * Requires: php-curl is NOT needed. Only stream_socket_client + openssl (always in MAMP/PHP).
 */

/**
 * Convert $raw bytes from $from_enc to UTF-8.
 * Tries iconv() first (wider encoding support, e.g. CP874/Windows-874 Thai),
 * then falls back to mb_convert_encoding, then returns raw as last resort.
 */
function _charset_to_utf8(string $raw, string $from_enc): string {
    if ($raw === '') return '';
    // iconv aliases that differ from mb_string names
    static $iconv_aliases = [
        'TIS620' => 'TIS-620',
    ];
    $iconv_enc = $iconv_aliases[strtoupper($from_enc)] ?? $from_enc;

    if (function_exists('iconv')) {
        $result = @iconv($iconv_enc, 'UTF-8//TRANSLIT//IGNORE', $raw);
        if ($result !== false && $result !== '') return $result;
    }

    // mb_convert_encoding fallback — map names it recognises
    static $mb_aliases = [
        'WINDOWS-874' => 'TIS-620', 'CP874'        => 'TIS-620',
        'WINDOWS-1252'=> 'CP1252',  'WINDOWS-1250' => 'CP1250',
        'WINDOWS-1251'=> 'CP1251',  'WINDOWS-1253' => 'CP1253',
        'WINDOWS-1254'=> 'CP1254',  'WINDOWS-1255' => 'CP1255',
        'WINDOWS-1256'=> 'CP1256',  'WINDOWS-1257' => 'CP1257',
        'WINDOWS-1258'=> 'CP1258',  'TIS620'       => 'TIS-620',
    ];
    $mb_enc = $mb_aliases[strtoupper($from_enc)] ?? $from_enc;
    $result = @mb_convert_encoding($raw, 'UTF-8', $mb_enc);
    return ($result !== false && $result !== '') ? $result : $raw;
}

// ══════════════════════════════════════════════════════════════════════════════
//  ImapStream — minimal IMAP client over one SSL socket
// ══════════════════════════════════════════════════════════════════════════════

class ImapStream {
    private $sock;
    private int $tagNum = 0;
    private string $host;
    private array $recentLines = [];   // ring buffer of recent server lines, for diagnostics

    public function __construct(string $host, int $port, string $user, string $pass) {
        $this->host = $host;
        $ctx = stream_context_create(['ssl' => [
            'verify_peer'      => false,
            'verify_peer_name' => false,
        ]]);
        $errno = 0; $errstr = '';
        $this->sock = @stream_socket_client(
            "ssl://$host:$port", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx
        );
        if (!$this->sock) {
            throw new \RuntimeException("IMAP connect to $host:$port failed: $errstr ($errno)");
        }
        stream_set_timeout($this->sock, 30);

        $greeting = $this->readLine(); // e.g. "* OK Gimap ready" or "* BYE ..." if blocked
        if ($greeting === null) {
            throw new \RuntimeException("IMAP greeting missing — $host closed connection immediately (firewall/policy?).");
        }
        if (stripos($greeting, '* BYE') === 0 || stripos($greeting, '* NO') === 0) {
            throw new \RuntimeException("IMAP server refused connection: $greeting");
        }

        // Gmail App Passwords are 16 chars; spaces shown in Google UI are decorative.
        // IMAP LOGIN accepts both forms, but stripping spaces avoids edge-case quoting issues.
        $passClean = preg_replace('/\s+/', '', $pass);

        try {
            $resp = $this->run('LOGIN ' . $this->q($user) . ' ' . $this->q($passClean));
        } catch (\RuntimeException $e) {
            // run() already throws with the server's actual NO/BAD line — re-surface with hint
            $msg = $e->getMessage();
            $hint = '';
            if (stripos($msg, 'AUTHENTICATIONFAILED') !== false || stripos($msg, 'Invalid credentials') !== false) {
                $hint = ' → App Password rejected. Create a new one at https://myaccount.google.com/apppasswords (App Passwords need 2FA enabled).';
            } elseif (stripos($msg, 'WEBLOGIN') !== false || stripos($msg, 'Application-specific') !== false) {
                $hint = ' → Google requires App Password (not your normal password) for IMAP.';
            } elseif (stripos($msg, 'disabled') !== false || stripos($msg, 'not enabled') !== false) {
                $hint = ' → IMAP is disabled. Enable it in Gmail Settings → Forwarding and POP/IMAP.';
            }
            throw new \RuntimeException('IMAP ' . $msg . $hint);
        }
        if (!$resp['ok']) {
            // Server closed connection without OK/NO/BAD — usually Workspace policy blocking IMAP
            $tail = implode(' | ', array_slice($this->recentLines, -5));
            throw new \RuntimeException(
                'IMAP login: server closed connection without response. '
              . 'Likely cause: IMAP disabled in Gmail settings, or Workspace admin blocks IMAP for this account. '
              . 'Last server lines: [' . $tail . ']'
            );
        }
    }

    // ── High-level operations ─────────────────────────────────────────────────

    /**
     * SELECT a mailbox. Returns ['exists' => N, 'unseen' => N].
     */
    public function select(string $folder): array {
        $resp = $this->run('SELECT ' . $this->q($folder));
        $info = ['exists' => 0, 'unseen' => 0];
        foreach ($resp['lines'] as $l) {
            if (preg_match('/^\* (\d+) EXISTS/i', $l, $m))  $info['exists'] = (int)$m[1];
            if (preg_match('/\[UNSEEN (\d+)\]/i', $l, $m))  $info['unseen'] = (int)$m[1];
        }
        return $info;
    }

    /**
     * UID SEARCH — returns array of UIDs (as ints), newest-first.
     */
    public function search(string $criteria): array {
        $resp = $this->run('UID SEARCH ' . $criteria);
        foreach ($resp['lines'] as $l) {
            if (preg_match('/^\* SEARCH([\d\s]*)/i', $l, $m)) {
                $uids = array_values(array_filter(array_map('intval', preg_split('/\s+/', trim($m[1])))));
                rsort($uids);
                return $uids;
            }
        }
        return [];
    }

    /**
     * Batch fetch From/Subject/Date + FLAGS + SIZE for multiple UIDs.
     * One single IMAP command for the whole page — very fast.
     * Returns [ uid => ['uid','size','flags_raw','headers_raw'], ... ]
     */
    public function fetchOverview(array $uids): array {
        if (!$uids) return [];
        $list = implode(',', $uids);
        $resp = $this->run(
            "UID FETCH $list (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])"
        );
        return $this->parseOverviewBlocks($resp['lines']);
    }

    /**
     * Fetch a single full RFC 822 message by UID.
     * Returns the raw message string.
     */
    public function fetchFull(int $uid): string {
        $resp = $this->run("UID FETCH $uid (UID RFC822)");
        foreach ($resp['lines'] as $block) {
            if (!str_starts_with($block, '* ')) continue;
            $pos = strpos($block, "}\n");
            if ($pos !== false) {
                return rtrim(substr($block, $pos + 2), "\r\n )");
            }
        }
        return '';
    }

    /** UID COPY — copy a message to another folder. */
    public function copy(int $uid, string $destFolder): void {
        $this->run("UID COPY $uid " . $this->q($destFolder));
    }

    /** EXPUNGE — permanently remove messages flagged \Deleted. */
    public function expunge(): void {
        $this->run('EXPUNGE');
    }

    /**
     * Set or clear a flag on a message.
     * e.g. store(123, '+FLAGS', '\Seen')
     */
    public function store(int $uid, string $op, string $flag): void {
        $this->run("UID STORE $uid $op ($flag)");
    }

    /**
     * LIST mailboxes. Returns array of raw folder name strings.
     */
    public function listFolders(string $ref = '""', string $pattern = '"*"'): array {
        $resp    = $this->run("LIST $ref $pattern");
        $folders = [];
        foreach ($resp['lines'] as $l) {
            if (!preg_match('/^\* LIST/i', $l)) continue;
            // * LIST (\flags) "/" "INBOX"
            // * LIST (\flags) "/" [Gmail]/Drafts
            if (preg_match('/\* LIST\s+\([^)]*\)\s+(?:"[^"]*"|NIL)\s+"([^"]+)"/i', $l, $m)) {
                $folders[] = $m[1];
            } elseif (preg_match('/\* LIST\s+\([^)]*\)\s+(?:"[^"]*"|NIL)\s+(\S+)/i', $l, $m)) {
                $folders[] = $m[1];
            }
        }
        return $folders;
    }

    /**
     * STATUS for a single folder.
     * Returns ['total' => N, 'unread' => N].
     */
    public function status(string $folder): array {
        $resp   = $this->run('STATUS ' . $this->q($folder) . ' (MESSAGES UNSEEN)');
        $total  = 0; $unread = 0;
        foreach ($resp['lines'] as $l) {
            if (preg_match('/MESSAGES\s+(\d+)/i', $l, $m)) $total  = (int)$m[1];
            if (preg_match('/UNSEEN\s+(\d+)/i',   $l, $m)) $unread = (int)$m[1];
        }
        return compact('total', 'unread');
    }

    /** Gracefully close the IMAP session. */
    public function close(): void {
        if ($this->sock) {
            try { @fwrite($this->sock, 'A' . str_pad(++$this->tagNum, 5, '0', STR_PAD_LEFT) . " LOGOUT\r\n"); } catch (\Throwable $e) {}
            @fclose($this->sock);
            $this->sock = null;
        }
    }

    // ── Private: protocol layer ───────────────────────────────────────────────

    /**
     * Send an IMAP command and collect all response lines (handling literals).
     * Returns ['ok' => bool, 'lines' => [string, ...]]
     */
    private function run(string $cmd): array {
        $tag = 'A' . str_pad(++$this->tagNum, 5, '0', STR_PAD_LEFT);
        if (@fwrite($this->sock, "$tag $cmd\r\n") === false) {
            throw new \RuntimeException('IMAP write failed');
        }

        $lines  = [];
        $cur    = null;    // current untagged block being accumulated
        $ok     = false;

        while (true) {
            $line = $this->readLine();
            if ($line === null) break;

            // ── Tagged response: end of command ───────────────────────────────
            if (str_starts_with($line, $tag . ' ')) {
                if ($cur !== null) $lines[] = $cur;
                // Tag is followed by status token: OK | NO | BAD | BYE
                $rest      = ltrim(substr($line, strlen($tag)));
                $sp        = strpos($rest, ' ');
                $status    = strtoupper($sp === false ? $rest : substr($rest, 0, $sp));
                if (in_array($status, ['NO', 'BAD', 'BYE'], true)) {
                    throw new \RuntimeException("command failed → $line");
                }
                $ok = ($status === 'OK');
                break;
            }

            // ── New untagged response ─────────────────────────────────────────
            if (str_starts_with($line, '* ')) {
                if ($cur !== null) $lines[] = $cur;
                $cur = $line;
            } else {
                // Continuation line (closing ")" or extra data after literal)
                if ($cur !== null) $cur .= "\n" . $line;
            }

            // ── Literal handling: {N} at end of current line ──────────────────
            if (preg_match('/\{(\d+)\}$/', $line, $m)) {
                $need = (int)$m[1];
                $data = '';
                while (strlen($data) < $need) {
                    $chunk = @fread($this->sock, $need - strlen($data));
                    if ($chunk === false || $chunk === '') break;
                    $data .= $chunk;
                }
                $cur .= "\n" . $data;
            }
        }

        return ['ok' => $ok, 'lines' => $lines];
    }

    private function readLine(): ?string {
        if (!$this->sock || feof($this->sock)) return null;
        $line = @fgets($this->sock, 65536);
        if ($line === false) {
            $meta = stream_get_meta_data($this->sock);
            if (!empty($meta['timed_out'])) {
                throw new \RuntimeException('IMAP read timeout after 30s — server not responding.');
            }
            return null;
        }
        $line = rtrim($line, "\r\n");
        // Keep last 10 lines for diagnostics (cheap; bounded)
        $this->recentLines[] = $line;
        if (count($this->recentLines) > 10) array_shift($this->recentLines);
        return $line;
    }

    private function q(string $s): string {
        return '"' . addcslashes($s, '"\\') . '"';
    }

    /**
     * Parse accumulated FETCH blocks into an overview map keyed by UID.
     */
    private function parseOverviewBlocks(array $blocks): array {
        $result = [];
        foreach ($blocks as $block) {
            if (!preg_match('/^\* \d+ FETCH/i', $block)) continue;

            $uid = 0; $size = 0; $flagsRaw = ''; $headersRaw = '';

            if (preg_match('/\bUID\s+(\d+)/i',          $block, $m)) $uid      = (int)$m[1];
            if (preg_match('/\bRFC822\.SIZE\s+(\d+)/i',  $block, $m)) $size     = (int)$m[1];
            if (preg_match('/\bFLAGS\s+\(([^)]*)\)/i',  $block, $m)) $flagsRaw = $m[1];

            // Headers come after the literal marker "}\n"
            $litEnd = strpos($block, "}\n");
            if ($litEnd !== false) {
                $headersRaw = rtrim(substr($block, $litEnd + 2), "\r\n )");
            }

            if ($uid > 0) {
                $result[$uid] = compact('uid', 'size', 'flagsRaw', 'headersRaw');
            }
        }
        return $result;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Convenience factory
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Open an authenticated ImapStream using mail_config.json credentials.
 */
function inbox_connect(): ImapStream {
    $cfg  = readJson('mail_config.json');
    $user = trim($cfg['smtp_user']     ?? '');
    $pass = trim($cfg['smtp_password'] ?? '');
    if (!$user || !$pass) {
        throw new \RuntimeException('Mail credentials not configured. Go to Admin → Mail Config.');
    }
    return new ImapStream('imap.gmail.com', 993, $user, $pass);
}

/**
 * Parse IMAP FLAGS string into typed array.
 */
function inbox_parse_flags(string $raw): array {
    $lc = strtolower($raw);
    return [
        'seen'     => str_contains($lc, '\seen'),
        'flagged'  => str_contains($lc, '\flagged'),
        'answered' => str_contains($lc, '\answered'),
        'draft'    => str_contains($lc, '\draft'),
    ];
}

// ══════════════════════════════════════════════════════════════════════════════
//  RFC 822 / MIME parsing helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Decode MIME encoded-word: =?charset?B/Q?text?=
 */
function inbox_decode_header(string $h): string {
    if ($h === '') return '';
    // Join adjacent encoded words separated only by whitespace
    $h = preg_replace('/(=\?[^?]+\?[BQbq]\?[^?]*\?=)\s+(=\?[^?]+\?[BQbq]\?[^?]*\?=)/', '$1$2', $h);
    return preg_replace_callback('/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/', function ($m) {
        $raw = strtoupper($m[2]) === 'B'
            ? base64_decode(str_replace([' ', "\t"], '', $m[3]))
            : quoted_printable_decode(str_replace('_', ' ', $m[3]));
        $cs = strtoupper($m[1]);
        if ($cs !== 'UTF-8') {
            $raw = _charset_to_utf8($raw, $m[1]);
        }
        return $raw;
    }, $h) ?? $h;
}

/**
 * Parse raw RFC 822 header block → associative array (lowercased keys).
 * Handles folded (continuation) lines.
 */
function parse_rfc822_headers(string $raw): array {
    $raw = preg_replace("/\r\n([ \t])/", ' ', $raw);
    $raw = preg_replace("/\n([ \t])/",   ' ', $raw);
    $out = [];
    foreach (preg_split('/\r?\n/', $raw) as $line) {
        if ($line === '') break;
        $pos = strpos($line, ':');
        if ($pos === false) continue;
        $key = strtolower(trim(substr($line, 0, $pos)));
        $val = trim(substr($line, $pos + 1));
        $out[$key] = $val;
    }
    return $out;
}

/**
 * Parse "Display Name <email>" into ['name', 'email'].
 */
function inbox_parse_addr(string $raw): array {
    $raw = inbox_decode_header(trim($raw));
    if (preg_match('/^"?([^"<]*)"?\s*<([^>]+)>$/u', $raw, $m)) {
        return ['name' => trim($m[1], ' "\''), 'email' => trim($m[2])];
    }
    return ['name' => '', 'email' => trim($raw)];
}

/**
 * Parse comma-separated address list into [['name','email'], ...]
 */
function inbox_parse_addr_list(string $raw): array {
    if (trim($raw) === '') return [];
    $parts = []; $depth = 0; $cur = '';
    for ($i = 0; $i < strlen($raw); $i++) {
        $c = $raw[$i];
        if ($c === '<') { $depth++; $cur .= $c; }
        elseif ($c === '>') { $depth--; $cur .= $c; }
        elseif ($c === ',' && $depth === 0) { $parts[] = trim($cur); $cur = ''; }
        else $cur .= $c;
    }
    if (trim($cur) !== '') $parts[] = trim($cur);
    return array_values(array_filter(array_map('inbox_parse_addr', $parts)));
}

/**
 * RFC 2822 date string → ISO 8601.
 */
function inbox_date_iso(string $d): string {
    $d = trim($d); if (!$d) return '';
    $ts = @strtotime($d);
    return ($ts && $ts > 0) ? date('c', $ts) : $d;
}

// ══════════════════════════════════════════════════════════════════════════════
//  MIME body extraction (for message.php)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Full MIME body extractor from raw RFC 822 string.
 * Returns ['body' => string, 'is_html' => bool, 'plain' => string, 'attachments' => [...]]
 */
function inbox_extract_body_from_raw(string $raw): array {
    [$hdrRaw, $body] = _mime_split($raw);
    $html = ''; $plain = ''; $atts = []; $cidMap = [];

    _mime_walk(parse_rfc822_headers($hdrRaw), $body, $html, $plain, $atts, 0, $cidMap);

    return [
        'body'        => $html ?: ($plain ? nl2br(htmlspecialchars(trim($plain), ENT_QUOTES, 'UTF-8')) : ''),
        'is_html'     => $html !== '',
        'plain'       => $plain,
        'attachments' => $atts,
        'cid_map'     => $cidMap,   // keyed by CID → data URI (JS replaces cid: on client)
    ];
}

/**
 * Get short plain-text snippet from raw message (for preview).
 */
function inbox_get_snippet(string $raw, int $len = 180): string {
    [$hdrRaw, $body] = _mime_split($raw);
    $html = ''; $plain = ''; $atts = [];
    _mime_walk(parse_rfc822_headers($hdrRaw), $body, $html, $plain, $atts);
    $text = $plain ?: strip_tags($html);
    $text = preg_replace('/\s+/', ' ', trim($text));
    return mb_substr($text, 0, $len);
}

// ── Internal MIME helpers ─────────────────────────────────────────────────────

function _mime_split(string $raw): array {
    $pos = strpos($raw, "\r\n\r\n");
    if ($pos !== false) return [substr($raw, 0, $pos), substr($raw, $pos + 4)];
    $pos = strpos($raw, "\n\n");
    if ($pos !== false) return [substr($raw, 0, $pos), substr($raw, $pos + 2)];
    return [$raw, ''];
}

function _mime_boundary(string $ct): ?string {
    return preg_match('/boundary\s*=\s*"?([^";\r\n]+)"?/i', $ct, $m) ? rtrim(trim($m[1]), '"') : null;
}

function _mime_charset(string $ct): ?string {
    return preg_match('/charset\s*=\s*"?([^";\r\n]+)"?/i', $ct, $m) ? trim($m[1]) : null;
}

function _mime_decode(string $data, string $enc): string {
    return match (strtolower(trim($enc))) {
        'base64'           => (string)base64_decode(str_replace(["\r","\n"], '', $data)),
        'quoted-printable' => (string)quoted_printable_decode($data),
        default            => $data,
    };
}

/**
 * @param array  $cidMap  CID → data-URI map (populated while walking, used to replace cid: in HTML)
 */
function _mime_walk(array $headers, string $body, string &$html, string &$plain, array &$atts, int $depth = 0, array &$cidMap = []): void {
    $ct  = $headers['content-type']              ?? 'text/plain';
    $enc = $headers['content-transfer-encoding'] ?? '';
    $cd  = strtolower($headers['content-disposition'] ?? '');
    $cid = trim($headers['content-id'] ?? '', '<> ');

    // Multipart → recurse into each sub-part
    if (stripos($ct, 'multipart/') === 0) {
        $boundary = _mime_boundary($ct);
        if ($boundary) {
            $delim = '--' . $boundary;
            $parts = explode($delim, $body);
            array_shift($parts); array_pop($parts);
            foreach ($parts as $part) {
                $part = ltrim($part, "\r\n");
                [$pH, $pBody] = _mime_split($part);
                _mime_walk(parse_rfc822_headers($pH), $pBody, $html, $plain, $atts, $depth + 1, $cidMap);
            }
        }
        return;
    }

    // message/rfc822 (forwarded message embedded)
    if (stripos($ct, 'message/rfc822') === 0) {
        [$pH, $pBody] = _mime_split($body);
        _mime_walk(parse_rfc822_headers($pH), $pBody, $html, $plain, $atts, $depth + 1, $cidMap);
        return;
    }

    // ── Inline image (cid: referenced from HTML body) ─────────────────────────
    // Detect: image/* mime type with a Content-ID header (and not explicitly "attachment")
    if (stripos($ct, 'image/') === 0 && $cid !== '' && stripos($cd, 'attachment') === false) {
        $imgData = _mime_decode(trim($body), $enc);
        $mime    = strtolower(trim(strtok($ct, ';')));
        // Store as data URI keyed by CID (both with and without angle brackets variants)
        $dataUri = 'data:' . $mime . ';base64,' . base64_encode($imgData);
        $cidMap[$cid] = $dataUri;
        // Also store without common suffix variations Gmail appends
        $cidMap[preg_replace('/@.*$/', '', $cid)] = $dataUri;
        return;
    }

    // ── File attachment ───────────────────────────────────────────────────────
    if (stripos($cd, 'attachment') !== false) {
        $fname = '';
        if (preg_match('/filename\s*=\s*"?([^";\r\n]+)"?/i', $headers['content-disposition'] ?? '', $m)) $fname = inbox_decode_header($m[1]);
        if (!$fname && preg_match('/name\s*=\s*"?([^";\r\n]+)"?/i', $ct, $m)) $fname = inbox_decode_header($m[1]);
        $atts[] = [
            'filename' => $fname ?: 'attachment',
            'mime'     => strtolower(trim(strtok($ct, ';'))),
            'size'     => strlen($body),
            'cid'      => $cid,
        ];
        return;
    }

    // ── Text body ─────────────────────────────────────────────────────────────
    $decoded = _mime_decode(trim($body), $enc);
    $cs = _mime_charset($ct) ?: 'UTF-8';
    if (strtoupper($cs) !== 'UTF-8') {
        $decoded = _charset_to_utf8($decoded, $cs);
    }

    if (stripos($ct, 'text/html') !== false)        $html  .= $decoded;
    elseif (stripos($ct, 'text/plain') !== false)   $plain .= $decoded;
}

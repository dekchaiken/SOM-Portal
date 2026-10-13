<?php
/**
 * Shared service-priority lookup helpers.
 * Included by fetch.php, upload.php analysis step, and the cron task.
 */

function loadServiceSeverityMap(): array {
    // Team-scoped: matches api/service-severity/index.php. Falls back to root
    // (SM) when no team context is set (cron jobs, unauthenticated callers).
    $file = _teamDataPath('service-severity.json', $GLOBALS['_current_team'] ?? null);
    if (!file_exists($file)) return [];
    $data = json_decode(file_get_contents($file), true);
    return is_array($data['services'] ?? null) ? $data['services'] : [];
}

/**
 * Match a Kubernetes pod name to a service entry.
 * Pod names follow: {deployment}-{rs-hash}-{pod-hash}
 * Strategy: longest prefix match with a '-' boundary.
 *
 * Returns ['priority'=>'P1'|'P2'|'P3'|null, 'severity'=>'critical'|'warning'|'info', 'matched'=>bool]
 */
function lookupServicePriority(string $podName, array $serviceMap): array {
    $bestLen  = 0;
    $bestData = null;

    foreach ($serviceMap as $svcName => $svcData) {
        $len = strlen($svcName);
        if ($len <= $bestLen) continue;
        if ($podName === $svcName || str_starts_with($podName, $svcName . '-')) {
            $bestLen  = $len;
            $bestData = $svcData;
        }
    }

    if (!$bestData) {
        return ['priority' => null, 'severity' => 'info', 'matched' => false];
    }

    $priority = $bestData['priority'] ?? 'P3';
    $severity = match ($priority) {
        'P1'    => 'critical',
        'P2'    => 'warning',
        default => 'info',
    };

    return ['priority' => $priority, 'severity' => $severity, 'matched' => true];
}

function priorityToSeverity(?string $priority): string {
    return match ($priority) {
        'P1'    => 'critical',
        'P2'    => 'warning',
        default => 'info',
    };
}

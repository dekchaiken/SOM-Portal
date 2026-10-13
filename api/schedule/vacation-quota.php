<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$isAdmin = in_array($payload['role'] ?? '', ADMIN_ROLES);

// ── GET — anyone authenticated can read quotas ───────────────────────────────
if ($method === 'GET') {
    $userId = $_GET['user_id'] ?? '';
    
    if ($userId) {
        // Get detailed quota info for specific user
        $quotas = readJson('vacation-quotas.json') ?: [];
        $leaves = readJson('leave-requests.json') ?: [];

        $totalQuota = $quotas[$userId] ?? 0;
        $used = 0;
        $approvedLeaves = [];
        $currentYear = date('Y');

        foreach ($leaves as $leave) {
            if ($leave['user_id'] !== $userId ||
                $leave['status'] !== 'approved' ||
                $leave['type'] !== 'vacation') continue;

            // Count actual days for this year only (mirrors frontend getHpRem logic)
            if (!empty($leave['dates']) && is_array($leave['dates'])) {
                $yearDates = array_values(array_filter($leave['dates'],
                    fn($d) => str_starts_with((string)$d, $currentYear)
                ));
            } else {
                // Legacy start_date/end_date: iterate each calendar day
                $yearDates = [];
                $cur = new DateTime($leave['start_date'] ?? '');
                $end = new DateTime($leave['end_date'] ?? $leave['start_date'] ?? '');
                while ($cur <= $end) {
                    $ds = $cur->format('Y-m-d');
                    if (str_starts_with($ds, $currentYear)) $yearDates[] = $ds;
                    $cur->modify('+1 day');
                }
            }

            $dayCount = count($yearDates);
            if ($dayCount === 0) continue;

            $isHalf = ($leave['duration'] ?? 'full') === 'half';
            $days   = $isHalf ? $dayCount * 0.5 : (float)$dayCount;
            $used  += $days;
            $approvedLeaves[] = [
                'id'         => $leave['id'],
                'start_date' => $leave['start_date'],
                'end_date'   => $leave['end_date'],
                'days'       => $days,
            ];
        }

        // Build set of dates already counted from leave requests
        $coveredDates = [];
        foreach ($approvedLeaves as $al) {
            $cur = new DateTime($al['start_date']);
            $end = new DateTime($al['end_date']);
            while ($cur <= $end) {
                $coveredDates[$cur->format('Y-m-d')] = true;
                $cur->modify('+1 day');
            }
        }

        // Also count vacation entries in schedule.json not already covered by leave requests
        // (mirrors frontend getHpRem: extraFromSchedule)
        $schedule = readJson('schedule.json') ?: [];
        $extraFromSchedule = 0.0;
        foreach ($schedule as $date => $day) {
            if (!str_starts_with((string)$date, $currentYear)) continue;
            if (!isset($day['vacation']) || !is_array($day['vacation'])) continue;
            if (isset($coveredDates[$date])) continue;
            foreach ($day['vacation'] as $v) {
                if (is_array($v) && ($v['user_id'] ?? '') === $userId) {
                    $extraFromSchedule += (float)($v['days'] ?? 1);
                } elseif ($v === $userId) {
                    $extraFromSchedule += 1.0;
                }
            }
        }

        $totalUsed = $used + $extraFromSchedule;
        $remaining = $totalQuota - $totalUsed;

        respondOk([
            'user_id'        => $userId,
            'total_quota'    => $totalQuota,
            'used'           => $totalUsed,
            'remaining'      => $remaining,
            'approved_leaves' => $approvedLeaves,
        ]);
    } else {
        // Return all quotas (original behavior)
        $quotas = readJson('vacation-quotas.json') ?: [];
        respondOk($quotas);
    }
}

// All other methods: admin only
if (!$isAdmin) {
    respondError('Unauthorized', 403);
}

// ── POST — set vacation quotas ────────────────────────────────────────────────
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?: [];

    if (empty($body)) {
        respondError('No quota data provided');
    }

    // Validate: all values must be non-negative numbers (decimals like 0.5 allowed)
    foreach ($body as $uid => $quota) {
        if (!is_numeric($quota) || (float)$quota < 0) {
            respondError("Invalid quota for user $uid");
        }
    }

    // Save quotas
    $quotas = readJson('vacation-quotas.json') ?: [];
    foreach ($body as $uid => $quota) {
        $quotas[$uid] = (float)$quota;
    }

    if (writeJson('vacation-quotas.json', $quotas)) {
        respondOk($quotas, 'Quotas saved successfully');
    } else {
        respondError('Failed to save quotas', 500);
    }
}

respondError('Method not allowed', 405);
?>

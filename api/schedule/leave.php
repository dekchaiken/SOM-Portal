<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';
$isAdmin = in_array($payload['role'] ?? '', ADMIN_ROLES);

// ── Helper: expand a leave item into its list of dates ───────────────────────
function getLeaveDates($item) {
    if (!empty($item['dates']) && is_array($item['dates'])) {
        return $item['dates'];
    }
    // Fallback: generate range from start_date to end_date
    $start   = new DateTime($item['start_date']);
    $end     = new DateTime($item['end_date']);
    $current = clone $start;
    $dates   = [];
    while ($current <= $end) {
        $dates[] = $current->format('Y-m-d');
        $current->modify('+1 day');
    }
    return $dates;
}

// ── Helper: add or remove a leave entry from schedule.json ───────────────────
function syncLeaveToSchedule($item, $adding) {
    $slotMap = ['vacation' => 'vacation', 'sick' => 'sick', 'business' => 'business_leave'];
    $slot   = $slotMap[$item['type']] ?? 'sick';
    $userId = $item['user_id'];
    $dates  = getLeaveDates($item);
    $all    = readJson('schedule.json') ?: [];

    foreach ($dates as $dateKey) {
        if ($adding) {
            if (!isset($all[$dateKey]))        $all[$dateKey] = [];
            if (!isset($all[$dateKey][$slot])) $all[$dateKey][$slot] = [];

            $alreadyIn = false;
            foreach ($all[$dateKey][$slot] as $e) {
                $eid = is_array($e) ? ($e['user_id'] ?? '') : $e;
                if ($eid === $userId) { $alreadyIn = true; break; }
            }

            if (!$alreadyIn) {
                if (($item['duration'] ?? 'full') === 'half') {
                    $all[$dateKey][$slot][] = [
                        'user_id' => $userId,
                        'days'    => 0.5,
                        'period'  => $item['period'] ?? 'morning',
                    ];
                } else {
                    $all[$dateKey][$slot][] = $userId;
                }
            }
        } else {
            if (isset($all[$dateKey][$slot])) {
                $all[$dateKey][$slot] = array_values(array_filter(
                    $all[$dateKey][$slot],
                    function ($e) use ($userId) {
                        $eid = is_array($e) ? ($e['user_id'] ?? '') : $e;
                        return $eid !== $userId;
                    }
                ));
                if (empty($all[$dateKey][$slot])) unset($all[$dateKey][$slot]);
                if (empty($all[$dateKey]))         unset($all[$dateKey]);
            }
        }
    }

    writeJson('schedule.json', $all);
}

// ── GET — list leave requests ─────────────────────────────────────────────────
if ($method === 'GET') {
    $all = readJson('leave-requests.json') ?: [];

    if ($isAdmin) {
        $status = $_GET['status'] ?? '';
        if ($status && in_array($status, ['pending', 'approved', 'rejected'])) {
            $all = array_values(array_filter($all, fn($r) => $r['status'] === $status));
        }
        $items = $all;
    } else {
        // Regular user: all *approved* leaves (for team stats) + all statuses for own
        $uid   = $payload['sub'];
        $items = array_values(array_filter($all,
            fn($r) => $r['user_id'] === $uid || $r['status'] === 'approved'
        ));
    }

    usort($items, fn($a, $b) => strcmp($b['requested_at'] ?? '', $a['requested_at'] ?? ''));
    respondOk($items);
}

// ── POST — submit leave request (admin can force-assign for another user) ─────
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?: [];

    if (empty($body['type']))
        respondError('type required');

    if (!in_array($body['type'], ['vacation', 'sick', 'business']))
        respondError('type must be vacation, sick, or business');

    // Support dates[] array (new) or start_date/end_date (legacy)
    if (!empty($body['dates']) && is_array($body['dates'])) {
        $dates = array_values(array_unique(array_filter($body['dates'],
            fn($d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)
        )));
        sort($dates);
        if (empty($dates)) respondError('dates array is empty or invalid');
        $startDate = $dates[0];
        $endDate   = $dates[count($dates) - 1];
    } elseif (!empty($body['start_date']) && !empty($body['end_date'])) {
        if ($body['start_date'] > $body['end_date'])
            respondError('start_date must be before end_date');
        $startDate = $body['start_date'];
        $endDate   = $body['end_date'];
        // Build range for legacy requests
        $cur = new DateTime($startDate);
        $end = new DateTime($endDate);
        $dates = [];
        while ($cur <= $end) { $dates[] = $cur->format('Y-m-d'); $cur->modify('+1 day'); }
    } else {
        respondError('dates array or start_date/end_date required');
    }

    // Half day only allowed for single-day leaves
    if (count($dates) > 1 && ($body['duration'] ?? 'full') === 'half') {
        $body['duration'] = 'full';
    }

    // Admin can create on behalf of another user (force leave)
    $targetId      = $payload['sub'];
    $targetName    = $payload['name'];
    $targetAvatar  = $payload['avatar_url'] ?? null;
    $isForce       = false;

    if ($isAdmin && !empty($body['for_user_id'])) {
        $users = readJson('users.json') ?: [];
        $found = null;
        foreach ($users as $u) {
            if ($u['id'] === $body['for_user_id']) { $found = $u; break; }
        }
        if (!$found) respondError('Target user not found');
        $targetId     = $found['id'];
        $targetName   = $found['nickname'] ?? $found['name'];
        $targetAvatar = $found['avatar_url'] ?? null;
        $isForce      = true;
    }

    $item = [
        'id'           => genId('lr'),
        'user_id'      => $targetId,
        'user_name'    => $targetName,
        'avatar_url'   => $targetAvatar,
        'type'         => $body['type'],
        'dates'        => $dates,
        'start_date'   => $startDate,
        'end_date'     => $endDate,
        'reason'       => trim($body['reason'] ?? ''),
        'duration'     => $body['duration'] ?? 'full',
        'period'       => $body['period'] ?? null,
        'status'       => $isForce ? 'approved' : 'pending',
        'requested_at' => date('c'),
        'reviewed_by'  => $isForce ? $payload['name'] : null,
        'reviewed_at'  => $isForce ? date('c') : null,
        'review_note'  => $isForce ? ('สร้างโดย Admin: ' . $payload['name']) : null,
        'forced_by'    => $isForce ? $payload['sub'] : null,
    ];

    $all   = readJson('leave-requests.json') ?: [];
    $all[] = $item;
    writeJson('leave-requests.json', $all);

    // Immediately sync to schedule if admin force-approved
    if ($isForce) {
        syncLeaveToSchedule($item, true);
    }

    // Create notification for all admins (only for non-forced requests)
    if (!$isForce) {
        $users = readJson('users.json') ?: [];
        $adminIds = array_column(
            array_filter($users, fn($u) => in_array($u['role'] ?? '', ADMIN_ROLES)),
            'id'
        );
        
        if (!empty($adminIds)) {
            $leaveTypeLabels = ['vacation' => 'ลาพักร้อน', 'sick' => 'ลาป่วย', 'business' => 'ลากิจ'];
            $leaveType = $leaveTypeLabels[$item['type']] ?? 'ลา';
            $dateCount = count($item['dates']);
            $dateDesc  = $dateCount === 1
                ? $item['start_date']
                : "{$item['start_date']} ({$dateCount} วัน)";
            createNotification(
                $adminIds,
                'leave_request',
                '📋 คำขอลาใหม่',
                "{$targetName} ขอ{$leaveType} ({$dateDesc})",
                [
                    'leave_id' => $item['id'],
                    'requester_id' => $targetId,
                    'requester_name' => $targetName,
                ]
            );
        }
    }

    logActivity('leave_request', [
        'id'       => $item['id'],
        'type'     => $item['type'],
        'start'    => $item['start_date'],
        'end'      => $item['end_date'],
        'for_user' => $targetId,
        'forced'   => $isForce,
    ], $payload['sub'], $payload['name']);

    respondOk($item, 'Submitted');
}

// ── PUT — approve or reject (admin) ──────────────────────────────────────────
if ($method === 'PUT') {
    requireRole($payload, ADMIN_ROLES);
    if (!$id) respondError('ID required');

    $body   = json_decode(file_get_contents('php://input'), true) ?: [];
    $status = $body['status'] ?? '';
    if (!in_array($status, ['approved', 'rejected'])) respondError('status must be approved or rejected');

    $all        = readJson('leave-requests.json') ?: [];
    $found      = false;
    $item       = null;
    $prevStatus = null;

    foreach ($all as &$r) {
        if ($r['id'] !== $id) continue;
        $prevStatus      = $r['status'];
        $r['status']     = $status;
        $r['reviewed_by']= $payload['name'];
        $r['reviewed_at']= date('c');
        $r['review_note']= trim($body['review_note'] ?? '');
        $item  = $r;
        $found = true;
        break;
    }
    unset($r);

    if (!$found) respondError('Not found', 404);
    writeJson('leave-requests.json', $all);

    // Sync schedule: add when approved, remove when rejected (if was previously approved)
    if ($status === 'approved') {
        syncLeaveToSchedule($item, true);
    } elseif ($status === 'rejected' && $prevStatus === 'approved') {
        syncLeaveToSchedule($item, false);
    }

    logActivity('leave_review', ['id' => $id, 'status' => $status], $payload['sub'], $payload['name']);
    respondOk(null, 'Updated');
}

// ── PATCH — edit approved leave (admin only) ─────────────────────────────────
if ($method === 'PATCH') {
    requireRole($payload, ADMIN_ROLES);
    if (!$id) respondError('ID required');

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    
    if (!in_array($body['type'] ?? '', ['vacation', 'sick', 'business']))
        respondError('type must be vacation, sick, or business');

    // Support dates[] array (new) or start_date/end_date (legacy)
    if (!empty($body['dates']) && is_array($body['dates'])) {
        $patchDates = array_values(array_unique(array_filter($body['dates'],
            fn($d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)
        )));
        sort($patchDates);
        if (empty($patchDates)) respondError('dates array is empty or invalid');
        $patchStart = $patchDates[0];
        $patchEnd   = $patchDates[count($patchDates) - 1];
    } elseif (!empty($body['start_date']) && !empty($body['end_date'])) {
        if ($body['start_date'] > $body['end_date'])
            respondError('start_date must be before or equal to end_date');
        $patchStart = $body['start_date'];
        $patchEnd   = $body['end_date'];
        $cur = new DateTime($patchStart);
        $end = new DateTime($patchEnd);
        $patchDates = [];
        while ($cur <= $end) { $patchDates[] = $cur->format('Y-m-d'); $cur->modify('+1 day'); }
    } else {
        respondError('dates array or start_date/end_date required');
    }

    if (count($patchDates) > 1 && ($body['duration'] ?? 'full') === 'half') {
        $body['duration'] = 'full';
    }
    
    // Find the leave request
    $all = readJson('leave-requests.json') ?: [];
    $found = false;
    $oldItem = null;
    $itemIndex = -1;
    
    foreach ($all as $idx => $r) {
        if ($r['id'] === $id) {
            $oldItem = $r;
            $itemIndex = $idx;
            $found = true;
            break;
        }
    }
    
    if (!$found) respondError('Leave request not found', 404);
    if ($oldItem['status'] !== 'approved') respondError('Can only edit approved leaves', 422);
    
    // Check 30-day historical edit restriction
    $endDate = new DateTime($oldItem['end_date']);
    $today = new DateTime();
    $daysSinceEnd = $today->diff($endDate)->days;
    if ($endDate < $today && $daysSinceEnd > 30) {
        respondError('Cannot edit leave that ended more than 30 days ago', 422);
    }
    
    // Calculate days from dates[] array or start/end range
    function calculateDays($item_or_start, $endDate_or_null, $duration) {
        if (is_array($item_or_start)) {
            $cnt = !empty($item_or_start['dates']) ? count($item_or_start['dates'])
                 : (new DateTime($item_or_start['end_date']))->diff(new DateTime($item_or_start['start_date']))->days + 1;
            return ($duration === 'half') ? $cnt * 0.5 : (float)$cnt;
        }
        $start = new DateTime($item_or_start);
        $end   = new DateTime($endDate_or_null);
        $days  = $end->diff($start)->days + 1;
        return ($duration === 'half') ? $days * 0.5 : (float)$days;
    }

    $oldDays = calculateDays($oldItem, null, $oldItem['duration'] ?? 'full');
    $newDays = count($patchDates) > 0
        ? (($body['duration'] ?? 'full') === 'half' ? count($patchDates) * 0.5 : (float)count($patchDates))
        : calculateDays($patchStart, $patchEnd, $body['duration'] ?? 'full');
    
    $oldType = $oldItem['type'];
    $newType = $body['type'];
    
    // Calculate quota change (business leave does not consume vacation quota)
    $quotaChange = 0;
    if ($oldType === 'vacation' && $newType === 'vacation') {
        $quotaChange = $oldDays - $newDays; // Positive = quota restored, Negative = quota used
    } elseif ($oldType === 'vacation' && in_array($newType, ['sick', 'business'])) {
        $quotaChange = $oldDays; // Restore all vacation quota
    } elseif (in_array($oldType, ['sick', 'business']) && $newType === 'vacation') {
        $quotaChange = -$newDays; // Use vacation quota
    }
    
    // Check if user has enough quota for the change
    if ($quotaChange < 0) {
        $quotas = readJson('vacation-quotas.json') ?: [];
        $leaves = readJson('leave-requests.json') ?: [];
        $userId = $oldItem['user_id'];
        
        $totalQuota = $quotas[$userId] ?? 0;
        $usedQuota = 0;
        foreach ($leaves as $l) {
            if ($l['user_id'] === $userId && $l['status'] === 'approved' && $l['type'] === 'vacation' && $l['id'] !== $id) {
                $usedQuota += calculateDays($l, null, $l['duration'] ?? 'full');
            }
        }
        
        $remainingQuota = $totalQuota - $usedQuota;
        $requiredQuota = abs($quotaChange);
        
        if ($remainingQuota < $requiredQuota) {
            respondError("Insufficient vacation quota. Need $requiredQuota days but only $remainingQuota remaining", 422);
        }
    }
    
    // Build changes object for audit log
    $changes = [];
    $oldDatesArr = !empty($oldItem['dates']) ? $oldItem['dates'] : getLeaveDates($oldItem);
    if ($oldDatesArr !== $patchDates) {
        $changes['dates'] = ['old' => $oldDatesArr, 'new' => $patchDates];
    }
    if ($oldItem['start_date'] !== $patchStart) {
        $changes['start_date'] = ['old' => $oldItem['start_date'], 'new' => $patchStart];
    }
    if ($oldItem['end_date'] !== $patchEnd) {
        $changes['end_date'] = ['old' => $oldItem['end_date'], 'new' => $patchEnd];
    }
    if ($oldType !== $newType) {
        $changes['type'] = ['old' => $oldType, 'new' => $newType];
    }
    if (($oldItem['duration'] ?? 'full') !== ($body['duration'] ?? 'full')) {
        $changes['duration'] = ['old' => $oldItem['duration'] ?? 'full', 'new' => $body['duration'] ?? 'full'];
    }
    if (($oldItem['period'] ?? null) !== ($body['period'] ?? null)) {
        $changes['period'] = ['old' => $oldItem['period'] ?? null, 'new' => $body['period'] ?? null];
    }
    if (trim($oldItem['reason'] ?? '') !== trim($body['reason'] ?? '')) {
        $changes['reason'] = ['old' => $oldItem['reason'] ?? '', 'new' => $body['reason'] ?? ''];
    }
    
    // Create audit log entry
    $auditEntry = [
        'action' => 'edit',
        'timestamp' => date('c'),
        'admin_id' => $payload['sub'],
        'admin_name' => $payload['name'],
        'reason' => trim($body['edit_reason'] ?? ''),
        'changes' => $changes
    ];
    
    // Remove old schedule entries
    syncLeaveToSchedule($oldItem, false);
    
    // Update the leave request
    $all[$itemIndex]['dates']      = $patchDates;
    $all[$itemIndex]['start_date'] = $patchStart;
    $all[$itemIndex]['end_date']   = $patchEnd;
    $all[$itemIndex]['type']       = $newType;
    $all[$itemIndex]['duration']   = $body['duration'] ?? 'full';
    $all[$itemIndex]['period']     = $body['period'] ?? null;
    $all[$itemIndex]['reason']     = trim($body['reason'] ?? '');
    
    // Initialize audit_log if not exists
    if (!isset($all[$itemIndex]['audit_log'])) {
        $all[$itemIndex]['audit_log'] = [];
    }
    $all[$itemIndex]['audit_log'][] = $auditEntry;
    
    $updatedItem = $all[$itemIndex];
    
    // Add new schedule entries
    syncLeaveToSchedule($updatedItem, true);
    
    // Save changes
    writeJson('leave-requests.json', $all);
    
    // Log activity
    logActivity('leave_edit', [
        'id' => $id,
        'changes' => $changes,
        'quota_change' => $quotaChange
    ], $payload['sub'], $payload['name']);
    
    // Return response
    respondOk([
        'id' => $updatedItem['id'],
        'user_id' => $updatedItem['user_id'],
        'start_date' => $updatedItem['start_date'],
        'end_date' => $updatedItem['end_date'],
        'type' => $updatedItem['type'],
        'duration' => $updatedItem['duration'],
        'status' => $updatedItem['status'],
        'quota_change' => $quotaChange,
        'audit_log' => $updatedItem['audit_log']
    ], 'Leave updated successfully');
}

// ── DELETE — cancel request (owner=pending only, or admin) ───────────────────
if ($method === 'DELETE') {
    if (!$id) respondError('ID required');
    
    $cancelMode = isset($_GET['cancel']) && $_GET['cancel'] === 'true';
    
    if ($cancelMode) {
        // Cancel mode: admin only, changes status to 'cancelled' instead of deleting
        requireRole($payload, ADMIN_ROLES);
        
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $cancelReason = trim($body['cancel_reason'] ?? '');
        
        if (empty($cancelReason)) {
            respondError('cancel_reason is required');
        }
        
        $all = readJson('leave-requests.json') ?: [];
        $found = false;
        $item = null;
        
        foreach ($all as &$r) {
            if ($r['id'] === $id) {
                if ($r['status'] !== 'approved') {
                    respondError('Can only cancel approved leaves', 422);
                }
                
                // Check 30-day historical restriction
                $endDate = new DateTime($r['end_date']);
                $today = new DateTime();
                $daysSinceEnd = $today->diff($endDate)->days;
                if ($endDate < $today && $daysSinceEnd > 30) {
                    respondError('Cannot cancel leave that ended more than 30 days ago', 422);
                }
                
                $daysToRestore = 0;
                if ($r['type'] === 'vacation') {
                    $cnt = !empty($r['dates']) ? count($r['dates'])
                         : (new DateTime($r['end_date']))->diff(new DateTime($r['start_date']))->days + 1;
                    $daysToRestore = ($r['duration'] ?? 'full') === 'half' ? $cnt * 0.5 : (float)$cnt;
                }
                
                // Remove from schedule
                syncLeaveToSchedule($r, false);
                
                // Update status to cancelled
                $r['status'] = 'cancelled';
                $r['cancelled_at'] = date('c');
                $r['cancelled_by'] = $payload['name'];
                
                // Add audit log entry
                if (!isset($r['audit_log'])) {
                    $r['audit_log'] = [];
                }
                $r['audit_log'][] = [
                    'action' => 'cancel',
                    'timestamp' => date('c'),
                    'admin_id' => $payload['sub'],
                    'admin_name' => $payload['name'],
                    'reason' => $cancelReason
                ];
                
                $item = $r;
                $found = true;
                break;
            }
        }
        unset($r);
        
        if (!$found) respondError('Leave request not found', 404);
        
        writeJson('leave-requests.json', $all);
        
        logActivity('leave_cancel', [
            'id' => $id,
            'quota_restored' => $daysToRestore,
            'reason' => $cancelReason
        ], $payload['sub'], $payload['name']);
        
        respondOk([
            'id' => $item['id'],
            'status' => 'cancelled',
            'quota_restored' => $daysToRestore,
            'cancelled_at' => $item['cancelled_at'],
            'cancelled_by' => $item['cancelled_by']
        ], 'Leave cancelled successfully');
        
    } else {
        // Original delete mode: remove pending requests
        $all         = readJson('leave-requests.json') ?: [];
        $deletedItem = null;

        $filtered = array_values(array_filter($all, function ($r) use ($id, $payload, $isAdmin, &$deletedItem) {
            if ($r['id'] !== $id) return true;
            if ($isAdmin) { $deletedItem = $r; return false; }
            if ($r['user_id'] !== $payload['sub']) return true;
            if ($r['status'] !== 'pending') return true;
            $deletedItem = $r;
            return false;
        }));

        if (count($filtered) === count($all)) respondError('Not found or not allowed', 404);
        writeJson('leave-requests.json', $filtered);

        // Remove from schedule if it was approved
        if ($deletedItem && $deletedItem['status'] === 'approved') {
            syncLeaveToSchedule($deletedItem, false);
        }

        respondOk(null, 'Cancelled');
    }
}

respondError('Method not allowed', 405);

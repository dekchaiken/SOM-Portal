<?php
// ══════════════════════════════════════════════════════════════════
//  Shared helpers for /api/ma-status/*
// ══════════════════════════════════════════════════════════════════

// Seed list of Jenkins jobs to poll for MA status. Per-team override lives at
// data/{team}/ma-status-jenkins.json (edited via admin/ma-status.html) and
// wholly replaces this list when present.
function ma_default_jenkins_jobs(): array {
    return [
        [
            'label'       => 'Wallet Login MA',
            'server'      => 'TMN-OPS',
            'path'        => '/view/V1%20Maintenance%20page/job/wallet-maintenance_login',
            'state_param' => 'IS_MAINTENANCE',
            'on_values'   => ['1', 'true', 'True', true, 1],
            'critical'    => true,
        ],
        [
            'label'       => 'Register SAVING Service',
            'server'      => 'TMN-OPS',
            'path'        => '/view/V1%20Maintenance%20page/job/maintenance-register-SAVING-SERVICE',
            'state_param' => 'IS_MAINTENANCE',
            'on_values'   => ['true', 'True', true, '1', 1],
        ],
        [
            'label'       => 'SAVING Service',
            'server'      => 'TMN-OPS',
            'path'        => '/view/V1%20Maintenance%20page/job/maintenance-SAVING-SERVICE',
            'state_param' => 'IS_MAINTENANCE',
            'on_values'   => ['true', 'True', true, '1', 1],
        ],
        [
            'label'       => 'TMN Mobile Gateway Feature Toggle (last set)',
            'server'      => 'TMN-OPS',
            'path'        => '/view/Config%20Service/job/acm-tmn-mobile-gateway-feature-toggle',
            'state_param' => 'enable_feature',
            'on_values'   => ['false', 'False', false, '0', 0],
            'extra_param' => 'feature_name',
            'note'        => 'Shows last feature toggle set; ground truth in acm-config-server',
        ],
    ];
}

// Return the effective list — per-team override wins, otherwise defaults.
function ma_effective_jenkins_jobs(): array {
    $override = readJson('ma-status-jenkins.json');
    if (is_array($override) && $override) return $override;
    return ma_default_jenkins_jobs();
}

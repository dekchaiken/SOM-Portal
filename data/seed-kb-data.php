<?php
// Script to seed knowledge base data
$dataFile = __DIR__ . '/knowledge-base.json';
$kb = json_decode(file_get_contents($dataFile), true);

// Block Biz Rule entries
$blockBizRules = [
    ['Usecase' => 'acm-config-risk-engine', 'Tool' => 'Jenkins', 'Application' => 'acm-risk-engine', 'Key' => '-', 'Job' => 'Link', 'Manual' => 'Link', 'Monitor' => 'Link', 'Manual Dev' => 'Link', 'Remark' => 'Block Risk Engine ไป Shield (มองว่าเป็นพฤติกรรมที่ไม่ปกติ)'],
    ['Usecase' => 'acm-config-kyc-service', 'Tool' => 'Jenkins', 'Application' => 'acm-kyc-service-api', 'Key' => '-', 'Job' => 'Link', 'Manual' => 'Link', 'Monitor' => 'Link', 'Manual Dev' => 'Link', 'Remark' => 'Block Risk Engine ไป Shield ของ KYC'],
    ['Usecase' => 'login', 'Tool' => 'Jenkins', 'Application' => 'mobile-auth-service', 'Key' => '-', 'Job' => 'Link', 'Manual' => 'Link', 'Monitor' => 'Link', 'Manual Dev' => 'Link', 'Remark' => 'Block Service ไป Risk Engine ของ Login'],
    ['Usecase' => 'register-thai', 'Tool' => 'Jenkins', 'Application' => 'cross-register-composite', 'Key' => '-', 'Job' => 'Link', 'Manual' => 'Link', 'Monitor' => 'Link', 'Manual Dev' => 'Link', 'Remark' => 'Block Service ไป Risk Engine ของ Register-thai'],
    ['Usecase' => 'p2p', 'Tool' => 'Jenkins', 'Application' => 'transfer-composite', 'Key' => '-', 'Job' => 'Link', 'Manual' => 'Link', 'Monitor' => 'Link', 'Manual Dev' => 'Link', 'Remark' => 'Block Service ไป Risk Engine ของ P2P'],
    ['Usecase' => 'fundout', 'Tool' => 'Jenkins', 'Application' => 'fund-composite', 'Key' => '-', 'Job' => 'Link', 'Manual' => 'Link', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Block Service ไป Risk Engine ของ Fundout'],
    ['Usecase' => 'BSC/B2B Online payment (SOF BANK)', 'Tool' => 'Admin Portal', 'Application' => 'third-party-pay-composite', 'Key' => 'skip-b2b-bizrule-consult-accum', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'BSC/B2B Online payment (SOF BANK)'],
    ['Usecase' => 'Alipay (SOF BANK)', 'Tool' => 'Admin Portal', 'Application' => 'alipay-gn-composite', 'Key' => 'skip-gn-bizrule-consult-accum', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Alipay (SOF BANK)'],
    ['Usecase' => 'SDK BScanC Direct Debit', 'Tool' => 'Admin Portal', 'Application' => 'retail-seven-composite', 'Key' => 'ascend.retail-seven-composite.features.enable_direct_debit_bizrule', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'SDK BScanC Direct Debit'],
    ['Usecase' => 'acm-cross-fund-composite FUND IN', 'Tool' => 'Admin Portal', 'Application' => 'acm-cross-fund-composite', 'Key' => 'x-fund-skip-kyc-bizrule', 'Job' => '-', 'Manual' => 'Link', 'Monitor' => 'Link', 'Manual Dev' => '', 'Remark' => 'Bypass bizrule error for fundin-in direct-debit and fundin-in'],
    ['Usecase' => 'acm-cross-fund-composite FUND IN INAPP', 'Tool' => 'Admin Portal', 'Application' => 'acm-cross-fund-composite', 'Key' => 'x-fund-skip-kyc-bizrule', 'Job' => '-', 'Manual' => 'Link', 'Monitor' => 'Link', 'Manual Dev' => '', 'Remark' => 'Bypass bizrule error for fundin-in direct-debit and fundin-in'],
    ['Usecase' => 'acm-ccp-web-backend', 'Tool' => 'Admin Portal', 'Application' => 'acm-ccp-web-backend', 'Key' => 'ccp-web-skip-bizrule', 'Job' => '-', 'Manual' => 'Link', 'Monitor' => 'Link', 'Manual Dev' => '', 'Remark' => 'Bypass bizrule error for ccp-wep'],
    ['Usecase' => 'All', 'Tool' => 'Admin Portal', 'Application' => 'transfer-composite', 'Key' => 'biz-rule.bypass.all', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Bypass biz-rules error for all use case'],
    ['Usecase' => 'voucher', 'Tool' => 'Admin Portal', 'Application' => 'transfer-composite', 'Key' => 'biz-rule.bypass.voucher', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Bypass biz-rules error for voucher'],
    ['Usecase' => 'promptpay', 'Tool' => 'Admin Portal', 'Application' => 'transfer-composite', 'Key' => 'biz-rule.bypass.promptpay', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Bypass biz-rules error for promptpay'],
    ['Usecase' => 'p2p', 'Tool' => 'Admin Portal', 'Application' => 'transfer-composite', 'Key' => 'biz-rule.bypass.p2p', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Bypass biz-rules error for P2P'],
    ['Usecase' => 'Fundin direct debit , in-app', 'Tool' => 'Admin Portal', 'Application' => 'fund-composite', 'Key' => 'biz-rule.bypass', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Bypass default biz-rules error'],
    ['Usecase' => 'Gift Envelope redeem', 'Tool' => 'Admin Portal', 'Application' => 'event-fulfillment-service', 'Key' => 'biz-rules.bypass', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Bypass default Biz-Rules error'],
    ['Usecase' => 'Promptpay tag29 fundin', 'Tool' => 'Admin Portal', 'Application' => 'promptpay-service', 'Key' => 'biz-rule.bypass', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Bypass default Biz-Rule error'],
    ['Usecase' => 'SOF Direct debit CCP', 'Tool' => 'Admin Portal', 'Application' => 'payment-composite', 'Key' => 'biz-rule.bypass', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'Bypass default Biz-Rule error'],
    ['Usecase' => 'merchant type via CCP payment', 'Tool' => 'Admin Portal', 'Application' => 'payment-composite', 'Key' => 'merchant-consult-whitelist', 'Job' => '-', 'Manual' => '-', 'Monitor' => '-', 'Manual Dev' => 'Link', 'Remark' => 'merchant type via CCP payment'],
];

foreach ($blockBizRules as $idx => $data) {
    $kb['entries']['block-biz-rule'][] = [
        'id' => 'kb_' . str_pad($idx + 1, 3, '0', STR_PAD_LEFT),
        'data' => $data,
        'created_at' => '2026-04-18 00:00:00',
        'created_by' => 'usr_001',
        'updated_at' => '2026-04-18 00:00:00',
        'updated_by' => 'usr_001'
    ];
}

// Switch Gateway entries
$switchGateway = [
    ['Service Name' => 'Switch GW OPN {7-11 Group}', 'Service' => 'TMN', 'Tool' => '3rd Party', 'Link-Manual' => 'Link', 'Remark' => 'สลับ GW ของ MMCC : 7-11 จาก KTC <<>> BAY'],
    ['Service Name' => 'Switch GW OPN {4 Merchart}', 'Service' => 'TMN', 'Tool' => '3rd Party', 'Link-Manual' => 'Link', 'Remark' => 'สลับ GW ของ MMCC : Retailpayment , Lotus , Department , Fastfood จาก KTC <<>> BAY'],
    ['Service Name' => 'Switch SMS Notification (TMN)', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'สลับ SMS หรือ OTP ของ TMN ไปได้ IFB_SG , IFB_HK , FH'],
    ['Service Name' => 'Switch SMS Notification (NANO)', 'Service' => 'Nano', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'สลับ SMS หรือ OTP ของ NANO ไปได้ IFB_HK , FH'],
];

foreach ($switchGateway as $idx => $data) {
    $kb['entries']['switch-gateway'][] = [
        'id' => 'kb_sg_' . str_pad($idx + 1, 3, '0', STR_PAD_LEFT),
        'data' => $data,
        'created_at' => '2026-04-18 00:00:00',
        'created_by' => 'usr_001',
        'updated_at' => '2026-04-18 00:00:00',
        'updated_by' => 'usr_001'
    ];
}

// Restart & Stop-Start Service entries
$restartService = [
    ['Service Name' => 'Restart Service ECS (TMN)', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'สำหรับ Restart Service ที่อยู่บน ECS เฉพาะ Service TMN'],
    ['Service Name' => 'Restart Service EKS (TMN)', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'สำหรับ Restart Service ที่อยู่บน EKS เฉพาะ Service TMN'],
    ['Service Name' => 'Restart Service EKS (TMN) By one POD', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'สำหรับ Restart Service ที่อยู่บน EKS เฉพาะ Service TMN ทีละ POD'],
    ['Service Name' => 'Restart Service OCP (TMN)', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Remark' => 'สำหรับ Restart Service ที่อยู่บน OCP เฉพาะ Service TMN'],
    ['Service Name' => 'Restart Report RPT , CPG', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'สำหรับ Restart Report RPT , CPG'],
    ['Service Name' => 'ปรับขยาย Min ให้เท่ากับ Max Service EKS', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'ปรับขยาย Min ให้เท่ากับ Max Service EKS'],
    ['Service Name' => 'Delete POD EKS (TMN)', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'ทำการลบ pod แล้วรอให้ pod ใหม่ healthy ก่อน ถึงจะมาทุบ pod เฉพาะ Service TMN'],
    ['Service Name' => 'Stop-Start EKS services (TMN)', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'เอาไว้ Stop-Start services ที่อยู่บน EKS ของ TMN'],
    ['Service Name' => 'Clear MAPI', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'Clear MAPI'],
    ['Service Name' => 'Restart Service EKS (NANO)', 'Service' => 'Nano', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'สำหรับ Restart Service ที่อยู่บน EKS เฉพาะ Service NANO'],
    ['Service Name' => 'Restart Logstash Kibana (NANO)', 'Service' => 'Nano', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'สำหรับ Restart Logstash Kibana เฉพาะ NANO'],
    ['Service Name' => 'Delete POD EKS (NANO)', 'Service' => 'Nano', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'ทำการลบ pod แล้วรอให้ pod ใหม่ healthy ก่อน ถึงจะมาทุบ pod เฉพาะ Service NAMO'],
    ['Service Name' => 'Stop-Start EKS services (NANO)', 'Service' => 'Nano', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Remark' => 'เอาไว้ Stop-Start services ที่อยู่บน EKS ของ NANO'],
];

foreach ($restartService as $idx => $data) {
    $kb['entries']['restart-stop-start'][] = [
        'id' => 'kb_rs_' . str_pad($idx + 1, 3, '0', STR_PAD_LEFT),
        'data' => $data,
        'created_at' => '2026-04-18 00:00:00',
        'created_by' => 'usr_001',
        'updated_at' => '2026-04-18 00:00:00',
        'updated_by' => 'usr_001'
    ];
}

// Network SG & CF entries
$networkSG = [
    ['Service Name' => 'Switch AWS Network link Main (MTG-MAIN) To link Backup', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Job' => 'Link', 'Remark' => 'สลับ Network Direct link Main ไป Backup'],
    ['Service Name' => 'Switch Network link Core bus', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Job' => 'Link', 'Remark' => 'สลับ Network link Core bus'],
    ['Service Name' => 'Switch Network link เฉพาะ Bank,MPLS', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Job' => 'Link', 'Remark' => 'สลับ Network link เฉพาะ Bank,MPLS อื่นๆ'],
    ['Service Name' => 'Block IP on CloudFlare', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Job' => 'Link', 'Remark' => 'ไว้สำหรับ Block IP ที่ CloudFlare'],
    ['Service Name' => 'Bypass CloudFlare Service 7-eleven', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => 'Link', 'Job' => 'Link', 'Remark' => 'ไว้สำหรับ Bypass CloudFlare (หมายเหตุ ตอนนี้ทำได้ของ 7-11)'],
    ['Service Name' => 'Bypass CloudFlare Non-TMN Domain', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Job' => 'Link', 'Remark' => 'ไว้สำหรับ Bypass CloudFlare Domain บน Non-TMN'],
    ['Service Name' => 'Bypass CloudFlare TMN Domain On-cloud', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Job' => 'Link', 'Remark' => 'ไว้สำหรับ Bypass CloudFlare Domain บน TMN On-cloud'],
    ['Service Name' => 'Bypass CloudFlare TMN Domain On-Premise', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Job' => 'Link', 'Remark' => 'ไว้สำหรับ Bypass CloudFlare Domain บน Non-TMN'],
];

foreach ($networkSG as $idx => $data) {
    $kb['entries']['network-sg-cf'][] = [
        'id' => 'kb_nw_' . str_pad($idx + 1, 3, '0', STR_PAD_LEFT),
        'data' => $data,
        'created_at' => '2026-04-18 00:00:00',
        'created_by' => 'usr_001',
        'updated_at' => '2026-04-18 00:00:00',
        'updated_by' => 'usr_001'
    ];
}

// Restart Specify App entries
$restartApp = [
    ['Service Name' => 'asset-service (OCP)', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Remark' => 'กรณี Asset-service ไม่ consume message MA flag จาก ops-service-maintenance-server'],
    ['Service Name' => 'ops-service-maintenance-server (EKS) ops-service-maintenance-ui (EKS)', 'Service' => 'TMN', 'Tool' => 'Jenkins', 'Link-Manual' => '', 'Remark' => 'กรณี MA บน Admin portal มีปัญหา ใช้งานไม่ได้ ลอง รี'],
    ['Service Name' => 'acm-cpgreport-partner (OCP)', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Remark' => 'กรณี ตัสแคปชั่นไม่ขึ้น หรือ เว็ปของ cpg report มีปัญหาใช้งานไม่ได้'],
    ['Service Name' => 'acm-cpggame-report (OCP)', 'Service' => 'TMN', 'Tool' => 'Rundeck', 'Link-Manual' => 'Link', 'Remark' => 'กรณี ตัสแคปชั่นไม่ขึ้น หรือ เว็ปของ cpg game มีปัญหาใช้งานไม่ได้'],
];

foreach ($restartApp as $idx => $data) {
    $kb['entries']['restart-specify-app'][] = [
        'id' => 'kb_ra_' . str_pad($idx + 1, 3, '0', STR_PAD_LEFT),
        'data' => $data,
        'created_at' => '2026-04-18 00:00:00',
        'created_by' => 'usr_001',
        'updated_at' => '2026-04-18 00:00:00',
        'updated_by' => 'usr_001'
    ];
}

// Save
file_put_contents($dataFile, json_encode($kb, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
echo "✓ Knowledge base data seeded successfully!\n";
echo "  - Block Biz Rule: " . count($kb['entries']['block-biz-rule']) . " entries\n";
echo "  - Switch Gateway: " . count($kb['entries']['switch-gateway']) . " entries\n";
echo "  - Restart & Stop-Start: " . count($kb['entries']['restart-stop-start']) . " entries\n";
echo "  - Network SG & CF: " . count($kb['entries']['network-sg-cf']) . " entries\n";
echo "  - Restart Specify App: " . count($kb['entries']['restart-specify-app']) . " entries\n";

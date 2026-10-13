<?php
/**
 * Analytics Statistics API
 * Returns usage statistics
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/AnalyticsTracker.php';

$payload = requireAuth();
requireRole($payload, LEAD_ROLES);

$startDate = $_GET['start_date'] ?? date('Y-m-d', strtotime('-30 days'));
$endDate = $_GET['end_date'] ?? date('Y-m-d');

$tracker = new AnalyticsTracker();

// Get all events for the date range
$events = $tracker->loadEvents();
$startTime = strtotime($startDate);
$endTime = strtotime($endDate . ' 23:59:59');

// Filter events by date range
$filteredEvents = array_filter($events, function($event) use ($startTime, $endTime) {
    $eventTime = strtotime($event['timestamp']);
    return $eventTime >= $startTime && $eventTime <= $endTime;
});

// Calculate summary stats
$totalEvents = count($filteredEvents);
$uniqueUsers = [];
$totalPageViews = 0;
$totalFeatureUses = 0;
$pageViews = [];
$featureUses = [];

foreach ($filteredEvents as $event) {
    $uniqueUsers[$event['user_id_hash']] = true;
    
    if ($event['event_type'] === 'page_view') {
        $totalPageViews++;
        $page = $event['data']['page'] ?? 'unknown';
        if (!isset($pageViews[$page])) {
            $pageViews[$page] = 0;
        }
        $pageViews[$page]++;
    } elseif ($event['event_type'] === 'feature_use') {
        $totalFeatureUses++;
        $feature = $event['data']['feature'] ?? 'unknown';
        if (!isset($featureUses[$feature])) {
            $featureUses[$feature] = 0;
        }
        $featureUses[$feature]++;
    }
}

// Sort features by usage
arsort($featureUses);
arsort($pageViews);

// Get top and bottom features
$topFeatures = [];
$i = 0;
foreach ($featureUses as $feature => $count) {
    if ($i++ >= 10) break;
    $topFeatures[] = ['feature' => $feature, 'count' => $count];
}

$bottomFeatures = [];
$featureUsesReversed = array_reverse($featureUses, true);
$i = 0;
foreach ($featureUsesReversed as $feature => $count) {
    if ($i++ >= 10) break;
    $bottomFeatures[] = ['feature' => $feature, 'count' => $count];
}

// Get top pages
$topPages = [];
$i = 0;
foreach ($pageViews as $page => $count) {
    if ($i++ >= 10) break;
    $topPages[] = ['page' => $page, 'count' => $count];
}

// Get daily trends
$trends = $tracker->getUsageTrends('daily');

// Filter trends by date range
$dailyTrends = array_filter($trends, function($trend) use ($startDate, $endDate) {
    return $trend['period'] >= $startDate && $trend['period'] <= $endDate;
});

// Rename 'period' to 'date' for frontend
$dailyTrends = array_map(function($trend) {
    return [
        'date' => $trend['period'],
        'page_views' => $trend['page_views'],
        'feature_uses' => $trend['feature_uses'],
        'total_events' => $trend['total_events'],
        'unique_users' => $trend['unique_users'],
    ];
}, array_values($dailyTrends));

$stats = [
    'total_events' => $totalEvents,
    'unique_users' => count($uniqueUsers),
    'total_page_views' => $totalPageViews,
    'total_feature_uses' => $totalFeatureUses,
    'top_features' => $topFeatures,
    'bottom_features' => $bottomFeatures,
    'top_pages' => $topPages,
    'daily_trends' => $dailyTrends,
];

respondOk($stats, 'Analytics statistics retrieved');

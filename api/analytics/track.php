<?php
/**
 * Analytics Tracking API
 * Track user events
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/AnalyticsTracker.php';

$payload = requireAuth();

$body = getBody();
$eventType = $body['event_type'] ?? '';
$data = $body['data'] ?? [];

if (empty($eventType)) {
    respondError('event_type is required');
}

$tracker = new AnalyticsTracker();

switch ($eventType) {
    case 'page_view':
        $page = $data['page'] ?? '';
        if (empty($page)) {
            respondError('page is required for page_view');
        }
        $tracker->trackPageView($page, $payload['sub'], $data);
        break;
        
    case 'feature_use':
        $feature = $data['feature'] ?? '';
        if (empty($feature)) {
            respondError('feature is required for feature_use');
        }
        $tracker->trackFeatureUse($feature, $payload['sub'], $data);
        break;
        
    case 'action':
        $action = $data['action'] ?? '';
        if (empty($action)) {
            respondError('action is required for action event');
        }
        $tracker->trackAction($action, $payload['sub'], $data);
        break;
        
    default:
        respondError('Invalid event_type');
}

respondOk(null, 'Event tracked');

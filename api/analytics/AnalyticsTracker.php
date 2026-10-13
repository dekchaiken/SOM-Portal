<?php
/**
 * Usage Analytics Tracker
 * 
 * Privacy-first analytics system for tracking:
 * - Page views
 * - Feature usage
 * - User actions
 * - User journeys
 * 
 * Privacy features:
 * - User IDs are hashed
 * - No PII stored
 * - Configurable retention (default 90 days)
 * - GDPR-compliant
 * 
 * Usage:
 *   $tracker = new AnalyticsTracker();
 *   $tracker->trackPageView('dashboard', $userId);
 *   $tracker->trackFeatureUse('board_create_post', $userId);
 */

class AnalyticsTracker {
    private const RETENTION_DAYS = 90;
    private const MAX_EVENTS = 50000;

    // Team-scoped path — resolves per-team at call time via $_current_team.
    private function eventsFile(): string {
        return teamDataPath('analytics_events.json');
    }
    
    /**
     * Track page view
     * 
     * @param string $page Page path
     * @param string $userId User ID
     * @param array $metadata Additional metadata
     */
    public function trackPageView(string $page, string $userId, array $metadata = []): void {
        $this->trackEvent('page_view', $userId, array_merge([
            'page' => $page,
        ], $metadata));
    }
    
    /**
     * Track feature usage
     * 
     * @param string $feature Feature name
     * @param string $userId User ID
     * @param array $metadata Additional metadata
     */
    public function trackFeatureUse(string $feature, string $userId, array $metadata = []): void {
        $this->trackEvent('feature_use', $userId, array_merge([
            'feature' => $feature,
        ], $metadata));
    }
    
    /**
     * Track user action
     * 
     * @param string $action Action name
     * @param string $userId User ID
     * @param array $context Action context
     */
    public function trackAction(string $action, string $userId, array $context = []): void {
        $this->trackEvent('action', $userId, array_merge([
            'action' => $action,
        ], $context));
    }
    
    /**
     * Track generic event
     * 
     * @param string $eventType Event type
     * @param string $userId User ID
     * @param array $data Event data
     */
    private function trackEvent(string $eventType, string $userId, array $data = []): void {
        $event = [
            'event_id' => $this->generateId('evt'),
            'timestamp' => date('c'),
            'event_type' => $eventType,
            'user_id_hash' => $this->hashUserId($userId),
            'session_id' => $this->getSessionId(),
            'data' => $data,
        ];
        
        $this->saveEvent($event);
    }
    
    /**
     * Get feature usage statistics
     * 
     * @param string $startDate Start date (ISO 8601)
     * @param string $endDate End date (ISO 8601)
     * @return array Statistics
     */
    public function getFeatureStats(string $startDate, string $endDate): array {
        $events = $this->loadEvents();
        $startTime = strtotime($startDate);
        $endTime = strtotime($endDate);
        
        $featureUsage = [];
        
        foreach ($events as $event) {
            if ($event['event_type'] !== 'feature_use') {
                continue;
            }
            
            $eventTime = strtotime($event['timestamp']);
            if ($eventTime < $startTime || $eventTime > $endTime) {
                continue;
            }
            
            $feature = $event['data']['feature'] ?? 'unknown';
            if (!isset($featureUsage[$feature])) {
                $featureUsage[$feature] = 0;
            }
            $featureUsage[$feature]++;
        }
        
        // Sort by usage descending
        arsort($featureUsage);
        
        return $featureUsage;
    }
    
    /**
     * Get user journeys
     * 
     * @param string $userId User ID
     * @param int $limit Max journeys to return
     * @return array User journeys
     */
    public function getUserJourneys(string $userId, int $limit = 100): array {
        $events = $this->loadEvents();
        $userIdHash = $this->hashUserId($userId);
        
        $userEvents = array_filter($events, function($event) use ($userIdHash) {
            return $event['user_id_hash'] === $userIdHash;
        });
        
        // Sort by timestamp
        usort($userEvents, function($a, $b) {
            return strtotime($a['timestamp']) - strtotime($b['timestamp']);
        });
        
        // Group by session
        $sessions = [];
        foreach ($userEvents as $event) {
            $sessionId = $event['session_id'];
            if (!isset($sessions[$sessionId])) {
                $sessions[$sessionId] = [];
            }
            $sessions[$sessionId][] = $event;
        }
        
        // Limit
        $sessions = array_slice($sessions, -$limit, $limit, true);
        
        return $sessions;
    }
    
    /**
     * Get heatmap data
     * 
     * @param string $page Page path
     * @param string $startDate Start date
     * @param string $endDate End date
     * @return array Heatmap data
     */
    public function getHeatmapData(string $page, string $startDate, string $endDate): array {
        $events = $this->loadEvents();
        $startTime = strtotime($startDate);
        $endTime = strtotime($endDate);
        
        $clicks = [];
        
        foreach ($events as $event) {
            if ($event['event_type'] !== 'action') {
                continue;
            }
            
            $eventTime = strtotime($event['timestamp']);
            if ($eventTime < $startTime || $eventTime > $endTime) {
                continue;
            }
            
            $eventPage = $event['data']['page'] ?? '';
            if ($eventPage !== $page) {
                continue;
            }
            
            $element = $event['data']['element'] ?? 'unknown';
            if (!isset($clicks[$element])) {
                $clicks[$element] = 0;
            }
            $clicks[$element]++;
        }
        
        return $clicks;
    }
    
    /**
     * Get usage trends
     * 
     * @param string $period Period (daily, weekly, monthly)
     * @return array Trends data
     */
    public function getUsageTrends(string $period = 'daily'): array {
        $events = $this->loadEvents();
        $trends = [];
        
        foreach ($events as $event) {
            $timestamp = strtotime($event['timestamp']);
            
            // Group by period
            switch ($period) {
                case 'daily':
                    $key = date('Y-m-d', $timestamp);
                    break;
                case 'weekly':
                    $key = date('Y-W', $timestamp);
                    break;
                case 'monthly':
                    $key = date('Y-m', $timestamp);
                    break;
                default:
                    $key = date('Y-m-d', $timestamp);
            }
            
            if (!isset($trends[$key])) {
                $trends[$key] = [
                    'period' => $key,
                    'total_events' => 0,
                    'unique_users' => [],
                    'page_views' => 0,
                    'feature_uses' => 0,
                    'actions' => 0,
                ];
            }
            
            $trends[$key]['total_events']++;
            $trends[$key]['unique_users'][$event['user_id_hash']] = true;
            
            switch ($event['event_type']) {
                case 'page_view':
                    $trends[$key]['page_views']++;
                    break;
                case 'feature_use':
                    $trends[$key]['feature_uses']++;
                    break;
                case 'action':
                    $trends[$key]['actions']++;
                    break;
            }
        }
        
        // Convert unique_users to count
        foreach ($trends as &$trend) {
            $trend['unique_users'] = count($trend['unique_users']);
        }
        
        // Sort by period
        ksort($trends);
        
        return array_values($trends);
    }
    
    /**
     * Cleanup old events
     * 
     * @return int Number of events deleted
     */
    public function cleanupOldEvents(): int {
        $events = $this->loadEvents();
        $cutoffTime = time() - (self::RETENTION_DAYS * 24 * 60 * 60);
        
        $originalCount = count($events);
        
        $events = array_filter($events, function($event) use ($cutoffTime) {
            $eventTime = strtotime($event['timestamp']);
            return $eventTime >= $cutoffTime;
        });
        
        // Also limit total events
        if (count($events) > self::MAX_EVENTS) {
            $events = array_slice($events, -self::MAX_EVENTS);
        }
        
        $this->saveEvents($events);
        
        return $originalCount - count($events);
    }
    
    // ─── Private Methods ──────────────────────────────────────────────────────
    
    /**
     * Save event
     */
    private function saveEvent(array $event): void {
        $events = $this->loadEvents();
        $events[] = $event;
        
        // Limit events
        if (count($events) > self::MAX_EVENTS) {
            $events = array_slice($events, -self::MAX_EVENTS);
        }
        
        $this->saveEvents($events);
    }
    
    /**
     * Load events from file
     */
    public function loadEvents(): array {
        $path = $this->eventsFile();
        if (!file_exists($path)) {
            return [];
        }
        $data = @file_get_contents($path);
        if (!$data) {
            return [];
        }
        return json_decode($data, true) ?? [];
    }

    /**
     * Save events to file
     */
    private function saveEvents(array $events): void {
        $path = $this->eventsFile();
        $dir  = dirname($path);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        $data = json_encode($events, JSON_UNESCAPED_UNICODE);
        @file_put_contents($path, $data, LOCK_EX);
    }
    
    /**
     * Hash user ID for privacy
     */
    private function hashUserId(string $userId): string {
        return hash('sha256', $userId . JWT_SECRET);
    }
    
    /**
     * Get or create session ID
     */
    private function getSessionId(): string {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        
        if (!isset($_SESSION['analytics_session_id'])) {
            $_SESSION['analytics_session_id'] = $this->generateId('sess');
        }
        
        return $_SESSION['analytics_session_id'];
    }
    
    /**
     * Generate ID
     */
    private function generateId(string $prefix): string {
        return $prefix . '_' . bin2hex(random_bytes(8));
    }
}


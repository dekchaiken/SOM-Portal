<?php
/**
 * Performance Monitor
 * 
 * Tracks system performance metrics:
 * - Request duration
 * - Request count
 * - Error rates
 * - Cache hit/miss rates
 * - System resources (CPU, memory, disk)
 * 
 * Exposes metrics in Prometheus format
 * 
 * Usage:
 *   $monitor = PerformanceMonitor::getInstance();
 *   $timerId = $monitor->startTimer('operation');
 *   // ... do work ...
 *   $monitor->endTimer($timerId);
 */

class PerformanceMonitor {
    private static ?PerformanceMonitor $instance = null;
    private const METRICS_FILE = __DIR__ . '/../../data/metrics.json';
    
    private array $timers = [];
    private array $metrics = [];
    
    private function __construct() {
        $this->loadMetrics();
    }
    
    public static function getInstance(): PerformanceMonitor {
        if (self::$instance === null) {
            self::$instance = new PerformanceMonitor();
        }
        return self::$instance;
    }
    
    /**
     * Start timing an operation
     * 
     * @param string $operation Operation name
     * @return string Timer ID
     */
    public function startTimer(string $operation): string {
        $timerId = uniqid('timer_', true);
        $this->timers[$timerId] = [
            'operation' => $operation,
            'start' => microtime(true),
        ];
        return $timerId;
    }
    
    /**
     * End timing and record metric
     * 
     * @param string $timerId Timer ID from startTimer()
     * @return float Duration in seconds
     */
    public function endTimer(string $timerId): float {
        if (!isset($this->timers[$timerId])) {
            return 0.0;
        }
        
        $timer = $this->timers[$timerId];
        $duration = microtime(true) - $timer['start'];
        
        $this->recordMetric(
            'operation_duration_seconds',
            $duration,
            ['operation' => $timer['operation']]
        );
        
        unset($this->timers[$timerId]);
        return $duration;
    }
    
    /**
     * Record a metric value
     * 
     * @param string $name Metric name
     * @param float $value Metric value
     * @param array $labels Labels (key-value pairs)
     */
    public function recordMetric(string $name, float $value, array $labels = []): void {
        $key = $this->getMetricKey($name, $labels);
        
        if (!isset($this->metrics[$key])) {
            $this->metrics[$key] = [
                'name' => $name,
                'type' => 'histogram',
                'labels' => $labels,
                'values' => [],
                'count' => 0,
                'sum' => 0,
            ];
        }
        
        $this->metrics[$key]['values'][] = $value;
        $this->metrics[$key]['count']++;
        $this->metrics[$key]['sum'] += $value;
        
        // Keep only last 1000 values
        if (count($this->metrics[$key]['values']) > 1000) {
            array_shift($this->metrics[$key]['values']);
        }
    }
    
    /**
     * Increment a counter
     * 
     * @param string $name Counter name
     * @param array $labels Labels
     * @param int $value Increment by (default 1)
     */
    public function incrementCounter(string $name, array $labels = [], int $value = 1): void {
        $key = $this->getMetricKey($name, $labels);
        
        if (!isset($this->metrics[$key])) {
            $this->metrics[$key] = [
                'name' => $name,
                'type' => 'counter',
                'labels' => $labels,
                'value' => 0,
            ];
        }
        
        $this->metrics[$key]['value'] += $value;
    }
    
    /**
     * Set a gauge value
     * 
     * @param string $name Gauge name
     * @param float $value Value
     * @param array $labels Labels
     */
    public function setGauge(string $name, float $value, array $labels = []): void {
        $key = $this->getMetricKey($name, $labels);
        
        $this->metrics[$key] = [
            'name' => $name,
            'type' => 'gauge',
            'labels' => $labels,
            'value' => $value,
            'timestamp' => time(),
        ];
    }
    
    /**
     * Get all metrics in Prometheus format
     * 
     * @return string Metrics in Prometheus text format
     */
    public function getMetrics(): string {
        $this->collectSystemMetrics();
        
        $output = [];
        $groupedMetrics = [];
        
        // Group metrics by name
        foreach ($this->metrics as $metric) {
            $name = $metric['name'];
            if (!isset($groupedMetrics[$name])) {
                $groupedMetrics[$name] = [];
            }
            $groupedMetrics[$name][] = $metric;
        }
        
        // Format each metric group
        foreach ($groupedMetrics as $name => $metrics) {
            $type = $metrics[0]['type'];
            $output[] = "# TYPE {$name} {$type}";
            
            foreach ($metrics as $metric) {
                $labels = $this->formatLabels($metric['labels']);
                
                if ($type === 'counter') {
                    $output[] = "{$name}{$labels} {$metric['value']}";
                } elseif ($type === 'gauge') {
                    $output[] = "{$name}{$labels} {$metric['value']}";
                } elseif ($type === 'histogram') {
                    $count = $metric['count'];
                    $sum = $metric['sum'];
                    $output[] = "{$name}_count{$labels} {$count}";
                    $output[] = "{$name}_sum{$labels} {$sum}";
                    
                    // Calculate percentiles
                    if (!empty($metric['values'])) {
                        $values = $metric['values'];
                        sort($values);
                        $p50 = $this->percentile($values, 50);
                        $p95 = $this->percentile($values, 95);
                        $p99 = $this->percentile($values, 99);
                        
                        $output[] = "{$name}_p50{$labels} {$p50}";
                        $output[] = "{$name}_p95{$labels} {$p95}";
                        $output[] = "{$name}_p99{$labels} {$p99}";
                    }
                }
            }
            
            $output[] = '';
        }
        
        return implode("\n", $output);
    }
    
    /**
     * Get metrics as array
     * 
     * @return array Metrics
     */
    public function getMetricsArray(): array {
        $this->collectSystemMetrics();
        return $this->metrics;
    }
    
    /**
     * Save metrics to file
     */
    public function saveMetrics(): void {
        $data = json_encode($this->metrics, JSON_PRETTY_PRINT);
        @file_put_contents(self::METRICS_FILE, $data, LOCK_EX);
    }
    
    /**
     * Load metrics from file
     */
    private function loadMetrics(): void {
        if (file_exists(self::METRICS_FILE)) {
            $data = @file_get_contents(self::METRICS_FILE);
            if ($data) {
                $this->metrics = json_decode($data, true) ?? [];
            }
        }
    }
    
    /**
     * Collect system metrics (CPU, memory, disk)
     */
    private function collectSystemMetrics(): void {
        // Memory usage
        $memoryUsage = memory_get_usage(true);
        $this->setGauge('system_memory_usage_bytes', $memoryUsage);
        
        // Peak memory
        $peakMemory = memory_get_peak_usage(true);
        $this->setGauge('system_memory_peak_bytes', $peakMemory);
        
        // Disk usage
        $dataDir = __DIR__ . '/../../data/';
        if (is_dir($dataDir)) {
            $diskFree = disk_free_space($dataDir);
            $diskTotal = disk_total_space($dataDir);
            $diskUsed = $diskTotal - $diskFree;
            
            $this->setGauge('system_disk_free_bytes', $diskFree, ['path' => 'data']);
            $this->setGauge('system_disk_total_bytes', $diskTotal, ['path' => 'data']);
            $this->setGauge('system_disk_used_bytes', $diskUsed, ['path' => 'data']);
            $this->setGauge('system_disk_usage_percent', ($diskUsed / $diskTotal) * 100, ['path' => 'data']);
        }
        
        // CPU load (if available)
        if (function_exists('sys_getloadavg')) {
            $load = sys_getloadavg();
            $this->setGauge('system_cpu_load_1m', $load[0]);
            $this->setGauge('system_cpu_load_5m', $load[1]);
            $this->setGauge('system_cpu_load_15m', $load[2]);
        }
    }
    
    /**
     * Get metric key from name and labels
     */
    private function getMetricKey(string $name, array $labels): string {
        ksort($labels);
        $labelStr = json_encode($labels);
        return md5($name . $labelStr);
    }
    
    /**
     * Format labels for Prometheus
     */
    private function formatLabels(array $labels): string {
        if (empty($labels)) {
            return '';
        }
        
        $parts = [];
        foreach ($labels as $key => $value) {
            $value = addslashes($value);
            $parts[] = "{$key}=\"{$value}\"";
        }
        
        return '{' . implode(',', $parts) . '}';
    }
    
    /**
     * Calculate percentile
     */
    private function percentile(array $values, float $percentile): float {
        $count = count($values);
        if ($count === 0) {
            return 0.0;
        }
        
        $index = ($percentile / 100) * ($count - 1);
        $lower = floor($index);
        $upper = ceil($index);
        
        if ($lower === $upper) {
            return $values[(int)$lower];
        }
        
        $fraction = $index - $lower;
        return $values[(int)$lower] * (1 - $fraction) + $values[(int)$upper] * $fraction;
    }
    
    /**
     * Destructor - save metrics on shutdown
     */
    public function __destruct() {
        $this->saveMetrics();
    }
}


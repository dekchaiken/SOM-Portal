# Cron Jobs Setup

## Installation

1. Make scripts executable:
```bash
chmod +x /path/to/centralize-som/cron/*.php
```

2. Add to crontab:
```bash
crontab -e
```

3. Add these lines:
```cron
# Daily backup at 2 AM
0 2 * * * /usr/bin/php /path/to/centralize-som/cron/daily-backup.php >> /path/to/centralize-som/data/logs/cron-backup.log 2>&1

# Log rotation at midnight
0 0 * * * /usr/bin/php /path/to/centralize-som/cron/log-rotation.php >> /path/to/centralize-som/data/logs/cron-rotation.log 2>&1

# Analytics cleanup on Sunday at 3 AM
0 3 * * 0 /usr/bin/php /path/to/centralize-som/cron/analytics-cleanup.php >> /path/to/centralize-som/data/logs/cron-analytics.log 2>&1
```

## Manual Testing

Test each cron job manually:

```bash
# Test backup
php /path/to/centralize-som/cron/daily-backup.php

# Test log rotation
php /path/to/centralize-som/cron/log-rotation.php

# Test analytics cleanup
php /path/to/centralize-som/cron/analytics-cleanup.php
```

## Monitoring

Check cron logs:
```bash
tail -f /path/to/centralize-som/data/logs/cron-*.log
```

## Troubleshooting

If cron jobs fail:

1. Check PHP path: `which php`
2. Check file permissions: `ls -la /path/to/centralize-som/cron/`
3. Check PHP errors: `php -l /path/to/centralize-som/cron/daily-backup.php`
4. Check cron logs: `grep CRON /var/log/syslog`

## Alternative: Using systemd timers (Linux)

Instead of cron, you can use systemd timers:

1. Create service files in `/etc/systemd/system/`:
   - `centralize-backup.service`
   - `centralize-backup.timer`

2. Enable and start:
```bash
sudo systemctl enable centralize-backup.timer
sudo systemctl start centralize-backup.timer
```

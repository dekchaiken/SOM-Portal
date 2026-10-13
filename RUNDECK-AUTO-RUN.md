# Rundeck Auto-Run Feature

## Overview
เพิ่มฟีเจอร์ Run Rundeck Job อัตโนมัติจากหน้า test-service.html โดยไม่ต้องเปิด Rundeck ด้วยตัวเอง

## Features
- ✅ Auto-login ด้วย username/password
- ✅ Trigger job พร้อม parameter `sftp_partner_name=CIMB`
- ✅ แสดงผลลัพธ์แบบ real-time
- ✅ Auto-refresh output ทุก 2 วินาที
- ✅ แสดง status (running/succeeded/failed)
- ✅ Link ไปดูใน Rundeck console

## How It Works

### 1. Authentication Flow
```
User clicks "Run Job Now"
  ↓
Login to Rundeck with username/password
  ↓
Get session cookie
  ↓
Use cookie for subsequent API calls
```

### 2. Job Execution Flow
```
Trigger job with API
  ↓
Get execution ID
  ↓
Poll for output every 2 seconds
  ↓
Display output in real-time
  ↓
Stop when job completes (max 30 attempts = 60 seconds)
```

### 3. API Endpoints Used
- `POST /j_security_check` - Login
- `POST /api/43/job/{jobId}/run` - Run job
- `GET /api/43/execution/{executionId}/output` - Get output
- `GET /api/43/execution/{executionId}` - Get status

## Files Created/Modified

### New Files
- ✅ `api/rundeck-proxy.php` - Proxy for Rundeck API with session management

### Modified Files
- ✅ `test-service.html` - Added UI and JavaScript for auto-run
- ✅ `.htaccess` - Added Rundeck headers (X-Rundeck-User, X-Rundeck-Pass)

## Configuration

### Credentials (in rundeck-proxy.php)
```php
$username = 'warapon.lea';
$password = 'Passw0rd#';
```

### Job Configuration
```php
$rundeckBase = 'https://th-ops-rundeck.mgt.ascendmoney.io';
$jobId = 'b87c7df1-2ec1-4480-9fe6-22a07f31ad02';
$project = 'SM';
```

### Job Parameters
```php
'sftp_partner_name' => 'CIMB'
```

## Usage

### From Web UI
1. Open `test-service.html`
2. Scroll to "Step 3: Rundeck sFTP File Checker"
3. Click **"🚀 Run Job Now"**
4. Wait for results (10-60 seconds)
5. View output in the result panel

### Buttons Available
- **🚀 Run Job Now** - Auto-run job with CIMB parameter
- **↗ เปิด Rundeck** - Open job page in Rundeck
- **💡 Tips** - Show/hide analysis tips

## Output Format

### Success
```
✅ Status: SUCCEEDED
Execution ID: 1234567
↗ View in Rundeck

[Log output showing files on sFTP server]
```

### Running
```
🔄 Status: RUNNING
Execution ID: 1234567
↗ View in Rundeck

[Partial log output, auto-refreshing...]
```

### Failed
```
❌ Status: FAILED
Execution ID: 1234567
↗ View in Rundeck

[Error log output]
```

## Troubleshooting

### If Auto-Run Fails

1. **Check Credentials**
   - Verify username: `warapon.lea`
   - Verify password: `Passw0rd#`
   - Update in `api/rundeck-proxy.php` if needed

2. **Check PHP Error Logs**
   - Look for "Rundeck Proxy:" entries
   - Check login status
   - Check API response codes

3. **Manual Fallback**
   - Click "↗ เปิด Rundeck" button
   - Login manually
   - Select `sftp_partner_name = CIMB`
   - Click "Run Job Now"

### Common Issues

**Issue: Login Failed**
- Solution: Check credentials in rundeck-proxy.php
- Check if account is locked or password expired

**Issue: Job Not Starting**
- Solution: Check if user has permission to run the job
- Verify job ID is correct

**Issue: No Output**
- Solution: Job might be running slowly
- Click "View in Rundeck" to see live output
- Check if job completed successfully

**Issue: Timeout**
- Solution: Job takes longer than 60 seconds
- Click "View in Rundeck" to see full output
- Increase `maxAttempts` in JavaScript if needed

## Security Notes

⚠️ **Important**: Credentials are stored in PHP file on server-side
- Not exposed to client browser
- Session cookies stored in temp directory
- Cookies are user-specific (based on username hash)

## API Actions

### Run Job
```
GET ./api/rundeck-proxy.php?action=run
Headers:
  X-Rundeck-User: warapon.lea
  X-Rundeck-Pass: Passw0rd#
```

### Get Output
```
GET ./api/rundeck-proxy.php?action=output&executionId=1234567
```

### Get Status
```
GET ./api/rundeck-proxy.php?action=status&executionId=1234567
```

## Future Enhancements

Possible improvements:
- [ ] Add credential configuration UI
- [ ] Support multiple partners (not just CIMB)
- [ ] Add execution history
- [ ] Add retry mechanism
- [ ] Add notification when job completes
- [ ] Cache recent executions

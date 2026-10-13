# Jenkins Authentication Fix

## Changes Made

### 1. Updated `api/jenkins-proxy.php`
- Set default credentials (username: `warapon.lea`, token: `115bed079dac44a59cbea48f9566f20651`)
- Removed requirement for headers (now uses defaults if not provided)
- Added more cURL options: `CURLOPT_SSL_VERIFYHOST`, `CURLOPT_FOLLOWLOCATION`
- Enhanced debug logging with auth header length and response length
- Added `Content-Type: application/json` header
- Updated CORS to allow `X-Jenkins-User` header

### 2. Updated `test-service.html`
- Added **Debug Panel** with toggle button (👁️ Debug)
- Shows detailed API request information:
  - Endpoint URL
  - Authentication credentials (username + partial token)
  - Jenkins URL
  - Response status
  - Response data preview
- Enhanced error messages to suggest using debug panel
- Better error handling with response text parsing

### 3. Created Test Script
- `test-jenkins-auth.php` - Direct authentication test without proxy
- Access at: `http://10.164.16.47:8888/ken-pj/centralize-som/test-jenkins-auth.php`
- Shows detailed authentication attempt and response

## How to Test

### Option 1: Use the Web UI
1. Open `test-service.html`
2. Scroll to "Step 2: Jenkins Job Status"
3. Click **"Check Jenkins Job"**
4. If error occurs, click **"👁️ Debug"** to see detailed request info
5. Check browser console for additional logs

### Option 2: Use Test Script
1. Navigate to: `http://10.164.16.47:8888/ken-pj/centralize-som/test-jenkins-auth.php`
2. View detailed authentication test results
3. Check if credentials work directly

### Option 3: Test with cURL (escaped brackets)
```bash
curl -u "warapon.lea:115bed079dac44a59cbea48f9566f20651" \
  "https://jenkins-batch-eks-cicd.private-a-cloud1p.ascendmoney.io/job/truemoney-fund-production/job/fund-out-reconcile-job-job-fund-out-reconcile-run-pipeline/api/json?tree=builds\[number,result,timestamp,duration,url\]\{0,5\}"
```

## Troubleshooting

### If Still Getting 401 Error

1. **Verify API Token**
   - Go to Jenkins → User Profile → Configure → API Token
   - Check if token `115bed079dac44a59cbea48f9566f20651` is still valid
   - Generate new token if needed

2. **Verify Username**
   - Confirm username is `warapon.lea` (not email)
   - Check user has permission to access the job

3. **Check PHP Error Logs**
   - Look for "Jenkins Proxy:" entries
   - Verify auth header is being sent correctly

4. **Test Direct Access**
   - Use the test script to verify credentials work
   - If test script fails, credentials need to be updated

## Files Modified
- ✅ `centralize-som/api/jenkins-proxy.php`
- ✅ `centralize-som/test-service.html`
- ✅ `centralize-som/.htaccess` (already had correct headers)
- ✅ `centralize-som/data/service-config.json` (already had correct config)

## Files Created
- ✅ `centralize-som/test-jenkins-auth.php` (test script)
- ✅ `centralize-som/JENKINS-AUTH-FIX.md` (this file)

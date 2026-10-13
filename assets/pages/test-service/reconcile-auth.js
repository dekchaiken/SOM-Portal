/**
 * reconcile-auth.js
 * Browser-based Keycloak authentication for Reconcile Status
 */

const KC_TOKEN_URL = 'https://acm-backoffice-aaa.backoffice-a-cloud1p.ascendmoney.io/realms/finops/protocol/openid-connect/token';
const KC_CLIENT = 'financial-portal-ui';

// Token cache
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get Keycloak token via browser (bypasses Cloudflare)
 */
async function getKeycloakToken(username, password) {
  try {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: KC_CLIENT,
      username: username,
      password: password,
      scope: 'openid profile api_scope email',
    });

    const resp = await fetch(KC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      const error = json.error || 'Login failed';
      const desc = json.error_description || '';
      
      let hint = '';
      if (error === 'invalid_grant') {
        hint = ' (รหัสผ่านไม่ถูกต้อง หรือ account ถูกล็อค)';
      } else if (error === 'unauthorized_client') {
        hint = ' (Client ไม่ได้รับอนุญาตให้ใช้ password grant)';
      }
      
      throw new Error((desc || error) + hint);
    }

    const json = await resp.json();
    if (!json.access_token) throw new Error('No access token received');

    // Cache token with expiry (30s buffer)
    cachedToken = json.access_token;
    tokenExpiry = Date.now() + ((json.expires_in || 300) - 30) * 1000;

    console.log('✅ Keycloak login successful, token expires in', json.expires_in, 'seconds');
    return json.access_token;
  } catch (err) {
    console.error('❌ Keycloak login error:', err);
    throw err;
  }
}

/**
 * Get valid token (auto-refresh if expired)
 */
async function getValidToken() {
  // Check if we have cached token that's still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    console.log('✅ Using cached token');
    return cachedToken;
  }

  // Get credentials from server (admin-configured)
  try {
    const authToken = Auth.getToken ? Auth.getToken()
      : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
    
    const resp = await fetch('./api/test-service-config.php?action=get-reconcile-credentials', {
      headers: authToken ? { 'Authorization': 'Bearer ' + authToken } : {},
    });
    
    if (!resp.ok) {
      throw new Error('ไม่สามารถดึง credentials ได้ กรุณาติดต่อ Admin');
    }
    
    const json = await resp.json();
    if (!json.success || !json.data.username || !json.data.password) {
      throw new Error('Admin ยังไม่ได้ตั้งค่า Reconcile Credentials กรุณาติดต่อ Admin');
    }

    console.log('🔐 Logging in to Keycloak with server credentials...');
    // Login to get new token
    return await getKeycloakToken(json.data.username, json.data.password);
  } catch (err) {
    console.error('❌ Failed to get credentials:', err);
    throw err;
  }
}

/**
 * Save credentials (admin only - called from admin panel)
 */
async function saveReconCredentials(username, password) {
  // Test login first
  const token = await getKeycloakToken(username, password);
  if (!token) throw new Error('Login test failed');

  // Credentials are saved via admin API, not localStorage
  return true;
}

/**
 * Clear cached token
 */
function clearTokenCache() {
  cachedToken = null;
  tokenExpiry = 0;
}

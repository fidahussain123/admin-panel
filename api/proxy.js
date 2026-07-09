// Vercel serverless proxy.
// Browser → https://<vercel>.vercel.app/api/admin/...
//        → AWS http://13.126.136.144:3001/api/admin/... (server-to-server, no mixed content)
//
// Config from the environment (Vercel project env vars). REMOTE_API_URL has a
// non-secret default; the admin credentials must come from the environment.
const REMOTE_API_URL = process.env.REMOTE_API_URL || 'http://13.126.136.144:3001/api';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Token cache survives across warm invocations on the same Lambda instance.
let cachedToken = null;
let tokenPromise = null;

async function fetchAdminToken() {
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const r = await fetch(`${REMOTE_API_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: ADMIN_PHONE, password: ADMIN_PASSWORD }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body?.data?.token) {
      throw new Error(body?.error || `admin login failed (${r.status})`);
    }
    cachedToken = body.data.token;
    return cachedToken;
  })().finally(() => { tokenPromise = null; });

  return tokenPromise;
}

async function getToken() {
  return cachedToken || fetchAdminToken();
}

export default async function handler(req, res) {
  // Strip the leading `/api` — what's left is the path on the AWS backend.
  const remotePath = req.url.replace(/^\/api/, '') || '/';
  const remoteUrl = `${REMOTE_API_URL}${remotePath}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0;

  const doFetch = (token) => fetch(remoteUrl, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: hasBody ? JSON.stringify(req.body) : undefined,
  });

  try {
    let token = await getToken();
    let upstream = await doFetch(token);

    // Token expired — refresh once and retry.
    if (upstream.status === 401) {
      cachedToken = null;
      token = await fetchAdminToken();
      upstream = await doFetch(token);
    }

    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('content-type', ct);
    res.send(text);
  } catch (err) {
    console.error('[proxy] error:', err.message);
    res.status(502).json({ success: false, error: 'Upstream API error: ' + err.message });
  }
}

// Firebase RTDB REST client — no firebase-admin needed
// Uses Web Crypto API (RS256 JWT) to obtain OAuth2 access tokens.

function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function b64url(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function fetchAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss:   sa.client_email,
    sub:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };

  const enc    = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const input  = `${enc(header)}.${enc(payload)}`;
  const key    = await crypto.subtle.importKey(
    'pkcs8', pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig    = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  const jwt    = `${input}.${b64url(sig)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

export function createFirebase(env) {
  const sa     = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const dbUrl  = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
  let tokenPr  = null;

  const token  = () => { tokenPr ??= fetchAccessToken(sa); return tokenPr; };

  async function req(method, path, body) {
    const t    = await token();
    const resp = await fetch(`${dbUrl}/${path}.json`, {
      method,
      headers: {
        Authorization:  `Bearer ${t}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`RTDB ${method} ${path} → ${resp.status}: ${text}`);
    }
    return resp.json();
  }

  return {
    get:    path        => req('GET',   path),
    set:    (path, val) => req('PUT',   path, val),
    update: (path, val) => req('PATCH', path, val),
    push:   (path, val) => req('POST',  path, val),
  };
}

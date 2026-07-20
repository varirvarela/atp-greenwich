// Web Push sender — implements RFC 8292 (VAPID) + RFC 8291/8188 (aes128gcm encryption)
// No dependencies; uses Web Crypto API built into Cloudflare Workers.

// ── Utility ────────────────────────────────────────────────────────────────────

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - b64.length % 4) % 4;
  const bin = atob(b64 + '='.repeat(pad));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function str(s) { return new TextEncoder().encode(s); }

// ── HKDF helpers ───────────────────────────────────────────────────────────────

async function hkdfExtract(salt, ikm) {
  const k = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, ikm));
}

// Single-block expand (length ≤ 32 bytes — sufficient for all our uses)
async function hkdfExpand(prk, info, length) {
  const k = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t = new Uint8Array(await crypto.subtle.sign('HMAC', k, concat(info, new Uint8Array([1]))));
  return t.slice(0, length);
}

// ── VAPID JWT (ES256) ──────────────────────────────────────────────────────────

async function vapidJWT(audience, vapidPublicKey, vapidPrivateKey) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: now + 43200, sub: 'mailto:atp.greenwich.league@gmail.com' };

  const enc   = obj => b64urlEncode(str(JSON.stringify(obj)));
  const input = `${enc(header)}.${enc(payload)}`;

  // Build JWK from the raw public/private key bytes
  const pub = b64urlDecode(vapidPublicKey); // 65-byte uncompressed P-256 point
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x:   b64urlEncode(pub.slice(1, 33)),
    y:   b64urlEncode(pub.slice(33, 65)),
    d:   vapidPrivateKey,
    key_ops: ['sign'], ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, str(input));
  return `${input}.${b64urlEncode(sig)}`;
}

// ── RFC 8291 payload encryption (aes128gcm) ───────────────────────────────────

async function encryptPayload(subscription, plaintext) {
  const subPub  = b64urlDecode(subscription.keys.p256dh); // 65 bytes
  const auth    = b64urlDecode(subscription.keys.auth);   // 16 bytes

  // Ephemeral server key pair
  const serverPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPub  = new Uint8Array(await crypto.subtle.exportKey('raw', serverPair.publicKey));

  // ECDH shared secret
  const subPubKey = await crypto.subtle.importKey('raw', subPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh      = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: subPubKey }, serverPair.privateKey, 256));

  // RFC 8291 key derivation
  const prk1 = await hkdfExtract(auth, ecdh);
  const ikm  = await hkdfExpand(prk1, concat(str('WebPush: info\0'), subPub, serverPub), 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk2 = await hkdfExtract(salt, ikm);
  const cek  = await hkdfExpand(prk2, str('Content-Encoding: aes128gcm\0'), 16);
  const iv   = await hkdfExpand(prk2, str('Content-Encoding: nonce\0'),     12);

  // Encrypt: plaintext + 0x02 record delimiter
  const aesKey     = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, concat(str(plaintext), new Uint8Array([2]))));

  // aes128gcm body: salt(16) + rs(4) + keyid_len(1) + keyid(65) + ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([serverPub.length]), serverPub, ciphertext);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function sendWebPush(subscription, payloadObj, env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const endpoint = subscription.endpoint;
  const audience = new URL(endpoint).origin;
  const jwt      = await vapidJWT(audience, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const body     = await encryptPayload(subscription, JSON.stringify(payloadObj));

  const resp = await fetch(endpoint, {
    method:  'POST',
    headers: {
      Authorization:      `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL:                '86400',
      Urgency:            'high',
    },
    body,
  });

  if (resp.status === 201) return;
  const err = Object.assign(new Error(`Push failed: ${resp.status}`), { statusCode: resp.status });
  throw err;
}

/**
 * Admin session cookie: signed, so it cannot be forged.
 *
 * The cookie used to be the literal string `authenticated`, checked against that same literal. The
 * password only gated ISSUING it; nothing validated it. Anyone could set one cookie by hand and walk
 * into a dashboard that writes to the production database — no password, no guessing. It was found by
 * doing exactly that while testing a route.
 *
 * Now the value is an expiry plus an HMAC over it. Without the secret you cannot produce a value that
 * verifies, and you cannot extend one you were given.
 *
 * Web Crypto rather than node:crypto so the same code runs in the proxy and in route handlers,
 * whichever runtime Next puts them on.
 */

const COOKIE = 'auth';
const VERSION = 'v1';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Signing key. AUTH_SECRET if set; otherwise ADMIN_PASSWORD, so this works with no new configuration
 * and a password change also invalidates every outstanding session — which is what you want from a
 * password change. Set AUTH_SECRET to decouple the two.
 */
function secret(): string | null {
  return process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || null;
}

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sign(payload: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payload)));
}

/** Compared in constant time so a forger cannot learn the signature byte by byte from timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Cookie value for a freshly authenticated session, or null if signing is not configured. */
export async function issueSession(): Promise<{ name: string; value: string; maxAge: number } | null> {
  const key = secret();
  if (!key) return null;
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${VERSION}.${expires}`;
  return { name: COOKIE, value: `${payload}.${await sign(payload, key)}`, maxAge: MAX_AGE_SECONDS };
}

/**
 * Is this cookie value a session we issued and still valid?
 *
 * Fails closed everywhere: an unset secret, a malformed value, a bad signature and an expired
 * timestamp are all simply "no". The expiry is inside the signed payload, so editing it invalidates
 * the signature rather than extending the session.
 */
export async function verifySession(value: string | undefined | null): Promise<boolean> {
  const key = secret();
  if (!key || !value) return false;

  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [version, expires, mac] = parts;
  if (version !== VERSION) return false;

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  return timingSafeEqual(mac, await sign(`${version}.${expires}`, key));
}

export const AUTH_COOKIE = COOKIE;

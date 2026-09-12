import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE, verifySession } from '@/lib/auth';

/**
 * Gate for the admin surface.
 *
 * Two holes closed here:
 *
 * 1. The cookie was compared to the literal string `authenticated` — a constant checked against
 *    itself. Setting that one cookie by hand walked past the password entirely. It is now a signed
 *    value and is verified, so a forged one fails.
 *
 * 2. The matcher covered the PAGES but not the APIs behind them, so every /api/admin/* route was
 *    public: 1.6MB of research data, the whole feed list, and the writes too. The pages were the
 *    only thing that had ever been protected.
 *
 * Next's own guidance is that a proxy is an optimistic check rather than a full authorization layer
 * (node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md). It is the right place to stop
 * unauthenticated traffic, but the admin routes should not treat "it reached me" as proof of
 * identity for anything destructive.
 */
export async function proxy(request: NextRequest) {
  const cookie = request.cookies.get(AUTH_COOKIE);

  if (await verifySession(cookie?.value)) {
    return NextResponse.next();
  }

  // An API caller gets a status it can act on. Redirecting XHR to an HTML login page produces a
  // confusing parse error at the call site instead of an obvious 401.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // /api/auth/* is deliberately absent: the login route has to be reachable to log in.
  matcher: ['/articles/:path*', '/admin/:path*', '/api/admin/:path*', '/api/agents/:path*'],
};

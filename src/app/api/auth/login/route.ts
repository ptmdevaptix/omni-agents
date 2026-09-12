import { NextRequest, NextResponse } from 'next/server';
import { issueSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const expected = process.env.ADMIN_PASSWORD;

  // Distinguished from a wrong password on purpose. Compared against an undefined expected value,
  // EVERY password is invalid — including the right one — and the old response blamed the user for a
  // misconfigured deploy. 503 so it reads as "this is broken", not "you are wrong".
  if (!expected) {
    console.error('[auth] ADMIN_PASSWORD is not set — no password can succeed');
    return NextResponse.json({ error: 'Login is not configured on this deployment' }, { status: 503 });
  }

  // Trimmed on both sides. A value pasted into the Vercel dashboard very often carries a trailing
  // newline or space, and an exact comparison then rejects the correct password with no way to see
  // why — the character is invisible in every UI that shows it. A password with meaningful leading
  // or trailing whitespace is not a thing worth supporting at the cost of that failure mode.
  if (String(password ?? '').trim() !== expected.trim()) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  // Signed, not the literal string "authenticated". That old value was a constant checked against
  // itself, so setting one cookie by hand bypassed the password entirely.
  const session = await issueSession();
  if (!session) {
    return NextResponse.json({ error: 'Login is not configured on this deployment' }, { status: 503 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(session.name, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAge,
  });

  return response;
}

import { NextResponse } from 'next/server';
import { auth } from '@/auth';

const authRequired = process.env.DASHBOARD_AUTH_REQUIRED === 'true';

export default auth((request) => {
  if (!authRequired || request.auth?.user) {
    return NextResponse.next();
  }

  // Already on the sign-in page (or its sub-paths) — let it render. Without
  // this guard an unauthenticated request to /signin would be redirected to
  // /signin again, causing an infinite redirect loop (ERR_TOO_MANY_REDIRECTS).
  if (request.nextUrl.pathname === '/signin' || request.nextUrl.pathname.startsWith('/signin/')) {
    return NextResponse.next();
  }

  // Unauthenticated. For API routes return JSON (not an HTML redirect to
  // /signin) so client `fetch` callers always receive parseable JSON instead
  // of silently failing on response.json().
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const signInUrl = new URL('/signin', request.nextUrl.origin);
  signInUrl.searchParams.set('callbackUrl', request.nextUrl.href);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: ['/((?!api/auth|signin|_next/static|_next/image|favicon.ico).*)'],
};

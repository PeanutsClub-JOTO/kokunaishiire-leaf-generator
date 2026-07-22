import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from '@/lib/auth/password-gate';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/api/cron',
  '/_next',
];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/favicon.ico') return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function loginUrl(req: NextRequest): URL {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return url;
}

export async function middleware(req: NextRequest) {
  if (!isAuthEnabled() || isPublicPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (await isValidAuthToken(token)) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.redirect(loginUrl(req));
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};

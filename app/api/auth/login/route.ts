import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE_NAME,
  createAuthToken,
  getAccessPassword,
} from '@/lib/auth/password-gate';

function safeNextPath(value: FormDataEntryValue | null): string {
  const path = typeof value === 'string' ? value : '/';
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  return path;
}

function redirectUrl(req: NextRequest, pathname: string): URL {
  return new URL(pathname, req.url);
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const submittedPassword = String(formData.get('password') ?? '');
  const nextPath = safeNextPath(formData.get('next'));
  const configuredPassword = getAccessPassword();

  if (!configuredPassword || submittedPassword !== configuredPassword) {
    const url = redirectUrl(req, '/login');
    url.searchParams.set('error', '1');
    url.searchParams.set('next', nextPath);
    return NextResponse.redirect(url, { status: 303 });
  }

  const response = NextResponse.redirect(redirectUrl(req, nextPath), { status: 303 });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: await createAuthToken(configuredPassword),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });

  return response;
}

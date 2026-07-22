import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth/password-gate';

export async function POST(req: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  response.cookies.delete(AUTH_COOKIE_NAME);
  return response;
}

export const AUTH_COOKIE_NAME = 'pc_app_auth';

const PASSWORD_ENV_KEYS = [
  'APP_ACCESS_PASSWORD',
  'SITE_PASSWORD',
  'BASIC_AUTH_PASSWORD',
];

export function getAccessPassword(): string | null {
  for (const key of PASSWORD_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function getSigningSecret(password: string): string {
  return process.env.APP_AUTH_SECRET?.trim() || password;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createAuthToken(password: string): Promise<string> {
  return `v1.${await sha256Hex(`${getSigningSecret(password)}:${password}`)}`;
}

export async function isValidAuthToken(token: string | undefined): Promise<boolean> {
  const password = getAccessPassword();
  if (!password) return true;
  if (!token) return false;
  return token === await createAuthToken(password);
}

export function isAuthEnabled(): boolean {
  return getAccessPassword() !== null;
}

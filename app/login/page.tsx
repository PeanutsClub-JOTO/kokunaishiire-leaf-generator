import { isAuthEnabled } from '@/lib/auth/password-gate';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
    error?: string;
  }>;
};

function safeNextPath(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  const hasError = params.error === '1';
  const authEnabled = isAuthEnabled();

  return (
    <main className="min-h-[calc(100vh-3.25rem)] bg-zinc-50 px-6 py-12">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-5">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">パスワード認証</h1>
          <p className="mt-1 text-xs text-zinc-500">企画業務自動化システム</p>
        </div>

        <form
          method="post"
          action="/api/auth/login"
          className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <input type="hidden" name="next" value={nextPath} />
          <label htmlFor="password" className="block text-xs font-medium text-zinc-600">
            パスワード
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          {hasError && (
            <p className="mt-2 text-xs font-medium text-red-600">パスワードが違います。</p>
          )}
          {!authEnabled && (
            <p className="mt-2 text-xs text-amber-700">
              パスワードが未設定のため、認証はまだ有効になっていません。
            </p>
          )}
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            開く
          </button>
        </form>
      </div>
    </main>
  );
}

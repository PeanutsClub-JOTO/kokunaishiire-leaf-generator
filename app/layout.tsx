import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '企画業務自動化システム | ピーナッツクラブ',
  description: 'メーカー見積書からリーフ自動生成',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full antialiased">
        {/* サイト共通トップナビ */}
        <header className="sticky top-0 z-20 h-13 bg-white border-b border-zinc-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="max-w-7xl mx-auto px-6 h-full flex items-center gap-3">
            {/* ブランドアクセント */}
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="flex items-center gap-0.5">
                <div className="w-1 h-5 rounded-full bg-indigo-600" />
                <div className="w-1 h-3.5 rounded-full bg-indigo-300" />
              </div>
              <span className="text-sm font-bold text-zinc-900 group-hover:text-indigo-700 transition-colors">
                企画業務自動化システム
              </span>
            </Link>
            <div className="w-px h-4 bg-zinc-200" />
            <span className="text-xs text-zinc-400 font-medium">ピーナッツクラブ 国内仕入部</span>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}

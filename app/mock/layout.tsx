// モック専用レイアウト: グローバルヘッダーを除外してフルスクリーン表示
export default function MockLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

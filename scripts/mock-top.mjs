import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dir, '../leaf-render-out/top-mock.png');

const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-zinc-50 min-h-screen">
<header class="bg-white border-b border-zinc-200 px-6 py-4">
  <div class="max-w-5xl mx-auto flex items-center justify-between">
    <div>
      <h1 class="text-lg font-bold text-zinc-900">企画業務自動化システム</h1>
      <p class="text-xs text-zinc-500 mt-0.5">ピーナッツクラブ 国内仕入部</p>
    </div>
  </div>
</header>
<main class="max-w-5xl mx-auto px-6 py-8 space-y-8">

  <!-- 取込フォーム -->
  <section class="bg-white rounded-xl border border-zinc-200 p-6">
    <h2 class="text-sm font-semibold text-zinc-700 mb-5">見積書を取り込む</h2>
    <div class="space-y-5">
      <div class="space-y-3">
        <label class="block text-xs font-medium text-zinc-500">Excel / PDF（.xlsx .xls .pdf）</label>
        <div class="flex items-center gap-3">
          <div class="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400">お見積書（ピーナッツクラブ様2026.4.28）.xlsx</div>
          <button class="shrink-0 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">取り込む</button>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex-1 h-px bg-zinc-200"></div>
        <span class="text-xs text-zinc-400">または</span>
        <div class="flex-1 h-px bg-zinc-200"></div>
      </div>
      <div class="space-y-3">
        <label class="block text-xs font-medium text-zinc-500">Google スプレッドシート URL</label>
        <div class="flex items-center gap-3">
          <div class="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-400">https://docs.google.com/spreadsheets/d/...</div>
          <button class="shrink-0 px-4 py-2 rounded-lg border border-zinc-300 text-zinc-700 text-sm font-medium">取り込む</button>
        </div>
      </div>
      <!-- 処理中ステータス例 -->
      <div class="flex items-center gap-2 rounded-lg px-4 py-3 text-sm bg-indigo-50 text-indigo-700">
        <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
        <span>処理中... 商品情報を解析しています</span>
      </div>
    </div>
  </section>

  <!-- 見積一覧 -->
  <section>
    <h2 class="text-sm font-semibold text-zinc-700 mb-3">取込済み見積一覧 <span class="text-xs font-normal text-zinc-400">3件</span></h2>
    <div class="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-zinc-500 text-xs">種別</th>
            <th class="px-4 py-3 text-left font-medium text-zinc-500 text-xs">ファイル名</th>
            <th class="px-4 py-3 text-left font-medium text-zinc-500 text-xs">取込日時</th>
            <th class="px-4 py-3 text-left font-medium text-zinc-500 text-xs">状態</th>
            <th class="px-4 py-3 text-left font-medium text-zinc-500 text-xs">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-100">
          <tr class="hover:bg-zinc-50">
            <td class="px-4 py-3"><span class="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">XLSX</span></td>
            <td class="px-4 py-3 text-zinc-700 text-xs">お見積書（ピーナッツクラブ様2026.4.28）.xlsx</td>
            <td class="px-4 py-3 text-zinc-400 text-xs">2026/06/09 13:45</td>
            <td class="px-4 py-3"><span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700">完了</span></td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <a class="text-xs text-zinc-500 hover:underline">判定結果</a>
                <a class="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white">リーフ編集 →</a>
              </div>
            </td>
          </tr>
          <tr class="hover:bg-zinc-50 opacity-75">
            <td class="px-4 py-3"><span class="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">XLSX</span></td>
            <td class="px-4 py-3 text-zinc-700 text-xs">お見積書（金沢兼六製菓2026.4.28）.xlsx</td>
            <td class="px-4 py-3 text-zinc-400 text-xs">2026/06/09 10:12</td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-1.5">
                <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700">処理中</span>
                <span class="text-xs text-zinc-400 animate-pulse">処理中…</span>
              </div>
            </td>
            <td class="px-4 py-3"><span class="text-zinc-300 text-xs">—</span></td>
          </tr>
          <tr class="hover:bg-zinc-50">
            <td class="px-4 py-3"><span class="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">PDF</span></td>
            <td class="px-4 py-3 text-zinc-700 text-xs">見積書_北辰フーズ_2026春.pdf</td>
            <td class="px-4 py-3 text-zinc-400 text-xs">2026/06/08 16:30</td>
            <td class="px-4 py-3"><span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700">完了</span></td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <a class="text-xs text-zinc-500 hover:underline">判定結果</a>
                <a class="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white">リーフ編集 →</a>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</main>
</body></html>`;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 820 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.screenshot({ path: out, type: 'png' });
await browser.close();
console.log(out);

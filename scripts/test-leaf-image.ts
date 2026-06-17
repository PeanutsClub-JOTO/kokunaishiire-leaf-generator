/**
 * リーフ画像生成テスト
 * Usage: npx tsx scripts/test-leaf-image.ts [--ai]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

import type { LeafletImageData } from '../lib/leaf/generate-image';
import { buildLeafImageHtml, generateLeafImageLocal, selectLeafTheme, detectCategory, flavorOf } from '../lib/leaf/generate-image';
import { generateCatchphrase } from '../lib/leaf/ai-catchphrase';
import { generateBackground } from '../lib/leaf/ai-background';

const SAMPLES: LeafletImageData[] = [
  {
    id: 'test-1',
    status: 'draft',
    leafName: 'マンゴーひとくちゼリー',
    productCode: 'JL-001',
    pjNo: 'PJ-2026-001',
    itemCount: 1,
    leafQty: 60,
    wholesalePrice: 3300,
    unitPrice: 55,
    isHalfOk: true,
    leadTime: '受注後約1週間',
    shelfLifeDays: 365,
    pieceSize: '30×30×20',
    note: null,
    productImages: [],
    flagMessages: [],
  },
  {
    id: 'test-2',
    status: 'draft',
    leafName: '金澤バウムクーヘン',
    productCode: 'JL-002',
    pjNo: 'PJ-2026-002',
    itemCount: 1,
    leafQty: 30,
    wholesalePrice: 3000,
    unitPrice: 100,
    isHalfOk: false,
    leadTime: '受注後約2週間',
    shelfLifeDays: 90,
    pieceSize: '120×120×80',
    note: '石川県産素材使用のしっとりバウム',
    productImages: [],
    flagMessages: [],
  },
  {
    id: 'test-3',
    status: 'draft',
    leafName: 'キャラメルポップコーン・チーズポップコーンアソート',
    productCode: 'JL-003',
    pjNo: 'PJ-2026-003',
    itemCount: 2,
    leafQty: 24,
    wholesalePrice: 2400,
    unitPrice: 100,
    isHalfOk: true,
    leadTime: '受注後約1週間',
    shelfLifeDays: 180,
    pieceSize: '80×80×120',
    note: null,
    productImages: [],
    flagMessages: [],
  },
];

const useAI = process.argv.includes('--ai');

async function generateSample(data: LeafletImageData, index: number) {
  console.log(`\n[${index + 1}] ${data.leafName} (${useAI ? 'AI mode' : 'rule-based'})`);

  let enriched = { ...data };

  if (useAI) {
    const theme = selectLeafTheme(data);
    const category = detectCategory(data.leafName);
    const flavor = flavorOf(data.leafName);

    console.log(`  → カテゴリ: ${category}, 味: ${flavor || '(なし)'}, テーマ: ${theme.label}`);
    console.log('  → キャッチコピー生成中...');

    const [catchphrase, bgBuffer] = await Promise.all([
      generateCatchphrase({ leafName: data.leafName, category, flavor, itemCount: data.itemCount, note: data.note, leadTime: data.leadTime }),
      generateBackground({ leafName: data.leafName, category, flavor, themeLabel: theme.label }),
    ]);

    if (catchphrase) {
      console.log(`  → main_copy: "${catchphrase.main_copy}"`);
      console.log(`  → sub_copy:  "${catchphrase.sub_copy}"`);
      enriched.catchphrase = catchphrase;
    } else {
      console.log('  → キャッチコピー: APIなし → ルールベースフォールバック');
    }

    if (bgBuffer) {
      console.log(`  → 背景画像: ${bgBuffer.length} bytes`);
      enriched.aiBgDataUrl = `data:image/png;base64,${bgBuffer.toString('base64')}`;
    } else {
      console.log('  → 背景画像: APIなし → CSSテーマフォールバック');
    }
  }

  console.log('  → Puppeteerでレンダリング中...');
  const result = await generateLeafImageLocal(enriched);

  const outDir = path.join(process.cwd(), 'public/ai-leaf-samples');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `sample-${index + 1}-${useAI ? 'ai' : 'rule'}.png`);
  fs.writeFileSync(outPath, result.buffer);
  console.log(`  ✓ 保存: ${outPath}`);
}

async function main() {
  console.log(`リーフ画像生成テスト (${useAI ? 'AI生成モード' : 'ルールベースモード'})`);
  console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '設定済み' : '未設定（ルールベースフォールバック）');

  for (let i = 0; i < SAMPLES.length; i++) {
    await generateSample(SAMPLES[i], i);
  }

  console.log('\n✅ 完了。public/ai-leaf-samples/ を確認してください。');
}

main().catch((e) => { console.error(e); process.exit(1); });

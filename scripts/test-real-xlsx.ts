/**
 * 実際の見積書XLSXからリーフ画像を生成するテストスクリプト
 * Usage: npx tsx scripts/test-real-xlsx.ts <xlsxPath>
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { extractXlsxCells } from '../lib/import/xlsx-cells';
import { extractXlsxImages } from '../lib/import/xlsx-images';
import { generateLeafImageLocal, selectLeafTheme, detectCategory, flavorOf } from '../lib/leaf/generate-image';
import { generateCatchphrase } from '../lib/leaf/ai-catchphrase';
import { generateBackground } from '../lib/leaf/ai-background';
import { upscaleToDataUrl } from '../lib/leaf/upscale-image';
import type { LeafletImageData } from '../lib/leaf/generate-image';

async function main() {
  const xlsxPath = process.argv[2];
  if (!xlsxPath) {
    console.error('Usage: npx tsx scripts/test-real-xlsx.ts <xlsxPath>');
    process.exit(1);
  }

  const buf = fs.readFileSync(xlsxPath);
  console.log(`読み込み: ${path.basename(xlsxPath)} (${buf.length} bytes)\n`);

  // セル情報を抽出
  const cellResult = extractXlsxCells(buf);
  // 画像を抽出
  const imageResult = await extractXlsxImages(buf);

  // 画像マップ: "sheetName:no" → アップスケール済みdataURL
  console.log(`画像アップスケール中（${imageResult.images.length}枚）...`);
  const imageByKey = new Map<string, string>();
  for (const img of imageResult.images) {
    const key = `${img.sheetName ?? ''}:${img.no}`;
    const dataUrl = await upscaleToDataUrl(img.buffer, img.mimeType);
    imageByKey.set(key, dataUrl);
  }
  console.log(`画像キー: ${[...imageByKey.keys()].join(', ')}`);

  console.log(`シート数: ${cellResult.length}`);
  console.log(`抽出画像数: ${imageResult.images.length}\n`);

  const outDir = path.join(process.cwd(), 'public/ai-leaf-samples');
  fs.mkdirSync(outDir, { recursive: true });

  let imageIndex = 0;

  for (const sheet of cellResult) {
    console.log(`\n=== シート: ${sheet.sheet_name} (${sheet.products.length}件) ===`);

    for (const p of sheet.products) {
      if (!p.product_name) continue;

      imageIndex++;
      const imgKey = `${sheet.sheet_name}:${p.no}`;
      const productImage = p.no != null ? imageByKey.get(imgKey) : undefined;
      const irisu = p.case_qty ?? 1;
      const minLot = p.min_lot_qty ?? 1;

      console.log(`\n[${imageIndex}] No.${p.no ?? '?'} ${p.product_name}`);
      console.log(`  原価: ${p.cost ?? '?'}円  入数: ${irisu}  最小ロット: ${minLot}`);
      if (p.parse_errors.length) console.log(`  警告: ${p.parse_errors.join(', ')}`);

      const leafData: LeafletImageData = {
        id: `real-${imageIndex}`,
        status: 'draft',
        leafName: p.product_name,
        productCode: null,
        pjNo: null,
        itemCount: 1,
        leafQty: minLot * irisu,
        wholesalePrice: Math.ceil((p.cost ?? 0) * minLot / 100) * 100,
        unitPrice: p.cost ?? 0,
        isHalfOk: false,
        leadTime: '受注後約1週間',
        shelfLifeDays: p.shelf_life_days ?? 0,
        pieceSize: p.piece_size ?? null,
        note: p.note ?? null,
        productImages: productImage ? [productImage] : [],
        flagMessages: [],
      };

      // Gemini APIキーが本物かチェック（プレースホルダー除外）
      const hasRealKey = process.env.GEMINI_API_KEY &&
        !process.env.GEMINI_API_KEY.startsWith('your-');

      if (hasRealKey) {
        const theme = selectLeafTheme(leafData);
        const category = detectCategory(leafData.leafName);
        const flavor = flavorOf(leafData.leafName);

        console.log(`  → AI生成中（テーマ: ${theme.label}, カテゴリ: ${category}）...`);

        const [catchphrase, bgBuffer] = await Promise.all([
          generateCatchphrase({ leafName: leafData.leafName, category, flavor, itemCount: 1, note: leafData.note, leadTime: leafData.leadTime }),
          generateBackground({ leafName: leafData.leafName, category, flavor, themeLabel: theme.label }),
        ]);

        if (catchphrase) {
          console.log(`  → main: "${catchphrase.main_copy}"`);
          console.log(`  → sub:  "${catchphrase.sub_copy}"`);
          leafData.catchphrase = catchphrase;
        }
        if (bgBuffer) {
          console.log(`  → 背景画像: ${(bgBuffer.length / 1024).toFixed(0)}KB`);
          leafData.aiBgDataUrl = `data:image/png;base64,${bgBuffer.toString('base64')}`;
        }
      } else {
        console.log('  → ルールベースモード（APIキー未設定）');
      }

      try {
        const result = await generateLeafImageLocal(leafData);
        const outPath = path.join(outDir, `real-${imageIndex}-${p.product_name?.replace(/[/\\?%*:|"<>\s]/g, '_').slice(0, 30)}.png`);
        fs.writeFileSync(outPath, result.buffer);
        console.log(`  ✓ ${path.basename(outPath)}`);
      } catch (e) {
        console.error(`  ✗ 生成失敗:`, e instanceof Error ? e.message : e);
      }
    }
  }

  console.log(`\n✅ 完了。public/ai-leaf-samples/ を確認してください。`);
}

main().catch((e) => { console.error(e); process.exit(1); });

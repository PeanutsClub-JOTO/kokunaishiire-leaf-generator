/**
 * Gemini を使ったキャッチコピー生成
 *
 * GEMINI_API_KEY が未設定の場合は null を返す → 呼び出し元がルールベースにフォールバック。
 */
import { fetchWithTimeout, timeoutMsFromEnv } from '../async/timeout';

export type Catchphrase = {
  main_copy: string;
  sub_copy: string;
};

function seasonFromLeadTime(leadTime: string): string {
  const t = leadTime ?? '';
  if (/春|3月|4月|5月/.test(t)) return '春';
  if (/夏|6月|7月|8月/.test(t)) return '夏';
  if (/秋|9月|10月|11月/.test(t)) return '秋・冬';
  if (/冬|12月|1月|2月/.test(t)) return '秋・冬';
  return '通年';
}

export async function generateCatchphrase(data: {
  leafName: string;
  category: string;
  flavor: string;
  itemCount: number;
  note?: string | null;
  leadTime?: string;
}): Promise<Catchphrase | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const assortContent =
    data.itemCount >= 2 ? data.leafName.split('・').join('、') : '';
  const season = seasonFromLeadTime(data.leadTime ?? '');

  const prompt = `以下の商品をゲームセンター景品向けリーフに掲載するためのキャッチコピーを作成してください。

商品名: ${data.leafName}
カテゴリ: ${data.category}
味・特徴: ${data.flavor || '（特記なし）'}
アイテム数: ${data.itemCount}
アソート内容: ${assortContent || '（単品）'}
販売時期: ${season}
備考: ${data.note?.trim() || '（なし）'}

条件:
- 2行以内
- 1行あたり18文字前後
- 営業が見て違和感のない表現
- 景品としての分かりやすさを優先
- 誇大表現は避ける
- 「絶品」「最高級」「必ず売れる」など断定的すぎる表現は禁止
- 商品名をそのまま長く繰り返さない
- 味・種類・食べやすさ・見た目の分かりやすさを訴求する
- 右上に大きく配置しても読みやすい短さにする

  出力はJSONのみ（コードブロック不要）:
{"main_copy":"キャッチコピー","sub_copy":"補足コピー"}`;

  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
        }),
      },
      timeoutMsFromEnv('AI_CATCHPHRASE_TIMEOUT_MS', 15_000),
      'Gemini catchphrase generation',
    );

    if (!res.ok) return null;

    const result = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    // コードブロックを除去してJSONをパース
    const jsonStr = raw.replace(/```json?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr) as Catchphrase;
    if (!parsed.main_copy) return null;
    return parsed;
  } catch {
    return null;
  }
}

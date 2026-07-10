/**
 * Gemini を使ったキャッチコピー生成
 *
 * GEMINI_API_KEY が未設定、または生成に失敗した場合は null を返す
 * → 呼び出し元がルールベースにフォールバック。
 */
import { timeoutMsFromEnv, withTimeout } from '../async/timeout';
import { getGeminiClient } from '../llm/gemini';

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

  const isAssort = data.itemCount >= 2;
  const assortNames = isAssort ? data.leafName.split(/[・＆&]/).map((s) => s.trim()).filter(Boolean) : [];
  const season = seasonFromLeadTime(data.leadTime ?? '');

  const prompt = `あなたはゲームセンター景品の販促リーフレットのコピーライターです。
以下の商品情報をもとに、思わず手が伸びるキャッチコピーを作成してください。

【商品情報】
商品名: ${data.leafName}
カテゴリ: ${data.category}
味・特徴: ${data.flavor || '（特記なし）'}
${isAssort ? `アソート内容（${data.itemCount}種）: ${assortNames.join('、')}` : ''}
販売時期: ${season}
備考: ${data.note?.trim() || '（なし）'}

【コピーの方針】
- メインコピー: 20文字以内。インパクト重視。商品の一番の魅力を一言で。
  - 味・食感・見た目・驚きなど、読んだ瞬間に「これ欲しい」と思わせる言葉を選ぶ
  - 「！」「♪」など記号を1つ使ってもOK
  - ${isAssort ? `${data.itemCount}種のアソートであることを自然に訴求する` : ''}
- サブコピー: 30文字以内。メインを補完する具体的な説明。
  - 食べ方・食感・シチュエーション・組み合わせの楽しさなど
  - 景品としての「もらって嬉しい」感も意識する

【禁止事項】
- 「絶品」「最高級」「必ず売れる」など過度な断定表現
- 商品名をそのまま長く繰り返す
- 「〜です」「〜ます」で終わる堅い文体

【良いコピーの例（参考）】
- 「たまらん旨さ、${data.category}の新定番！」
- 「${season === '夏' ? 'この夏イチオシ！' : ''}食べだしたら止まらない`
  + (data.flavor ? `、${data.flavor}の` : 'の')
  + `本格派」

出力はJSONのみ（コードブロック不要）:
{"main_copy":"メインコピー","sub_copy":"サブコピー"}`;

  try {
    const res = await withTimeout(
      getGeminiClient().generate(prompt, { temperature: 0.9 }),
      timeoutMsFromEnv('AI_CATCHPHRASE_TIMEOUT_MS', 15_000),
      'Gemini catchphrase generation',
    );

    const raw = res.text ?? '';
    const jsonStr = raw.replace(/```json?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr) as Catchphrase;
    if (!parsed.main_copy) {
      console.warn('[ai-catchphrase] empty main_copy, falling back. raw:', raw.slice(0, 200));
      return null;
    }
    console.log(`[ai-catchphrase] OK for "${data.leafName}": ${parsed.main_copy}`);
    return parsed;
  } catch (e) {
    console.warn('[ai-catchphrase] failed, falling back:', e instanceof Error ? e.message : e);
    return null;
  }
}

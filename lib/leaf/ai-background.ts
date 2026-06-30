/**
 * Imagen 3 を使った背景画像生成
 *
 * 商品本体・価格・文字は一切描かせない。
 * 商品画像・価格・コードはシステム側が後から合成する。
 *
 * Gemini 2.0 Flash を使って、商品名やカテゴリから
 * Imagen 3 向けの最適なプロンプトを動的に生成し、多様な背景に対応する。
 */
import { getGeminiClient } from '../llm/gemini';
import { fetchWithTimeout, timeoutMsFromEnv, withTimeout } from '../async/timeout';

export type BgInput = {
  leafName: string;
  category: string;
  flavor: string;
  themeLabel: string;
};

/**
 * Geminiを使ってImagen3向けの高品質なプロンプトを生成する
 */
async function generateDynamicPrompt(d: BgInput): Promise<string> {
  const client = getGeminiClient();

  const systemPrompt = `あなたはプロンプトエンジニアです。
日本のクレーンゲーム景品の販促リーフレット用の「背景画像」を生成するための、Imagen 3 向けの英語プロンプトを作成してください。

【重要ルール】
1. 実際の商品画像や文字、価格などは後からシステムで合成するため、背景には「絶対に商品本体、文字、数字、UI、枠線、人物」を描いてはいけません。
2. 背景のみ（テクスチャ、パターン、抽象的なモチーフ、風景のボケなど）を生成してください。
3. 左側（約45%）には商品画像が大きく置かれます。右側と下部にも情報が乗ります。
4. 提供された「商品情報」に合わせて、最適な雰囲気（和風、ポップ、涼しげ、高級感など）を選択してください。
5. 出力は英語のプロンプトのみ（50〜80単語程度）としてください。

【カテゴリ別のデザインアイデア（参考）】
- 和菓子（羊羹など）: Traditional Japanese washi paper texture, subtle gold leaf accents, elegant and calm, soft warm lighting, empty space.
- スナック（あられ、ポップコーンなど）: Vibrant colorful stripes, pop art style, dynamic and fun, abstract star bursts, bright colors.
- フルーツ・ゼリー: Fresh water splashes, sliced fruits flying in the air (abstracted), bright and juicy colors, refreshing atmosphere.
- スイーツ（チョコなど）: Elegant pastel colors, soft ribbons, luxurious and sweet atmosphere, bokeh lights.
- さっぱり（飲料など）: Clear blue sky, sparkling water drops, refreshing mint leaves, bright and airy.`;

  const userPrompt = `商品情報:
商品名: ${d.leafName}
カテゴリ: ${d.category}
味・特徴: ${d.flavor || '（特記なし）'}
想定テーマ: ${d.themeLabel}

この商品に最も合う、魅力的で多様な背景を生成するための英語プロンプトを出力してください。
商品本体やテキストは含めないでください。`;

  try {
    const res = await withTimeout(
      client.generate(userPrompt, { systemPrompt, temperature: 0.7 }),
      timeoutMsFromEnv('AI_PROMPT_TIMEOUT_MS', 15_000),
      'Gemini background prompt',
    );
    const prompt = res.text.trim();
    // 英語プロンプトの前後にImagen3への絶対の制約を付与
    return `${prompt}, 16:9, background only, absolutely NO text, NO numbers, NO products, NO boxes, empty center for text overlay, high quality, promotional material background.`;
  } catch (e) {
    console.warn('[ai-background] Gemini prompt generation failed, falling back to static prompt.', e);
    // フォールバック
    return `Beautiful abstract background for ${d.themeLabel} products, themed around ${d.flavor || d.category}. 16:9, background only, absolutely NO text, NO numbers, NO products, NO boxes, high quality, promotional material background.`;
  }
}

export async function generateBackground(input: BgInput): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = await generateDynamicPrompt(input);
  console.log(`[ai-background] Imagen3 Prompt: ${prompt}`);

  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '16:9',
            safetyFilterLevel: 'block_low_and_above',
            personGeneration: 'dont_allow',
          },
        }),
      },
      timeoutMsFromEnv('IMAGEN_TIMEOUT_MS', 45_000),
      'Imagen background generation',
    );

    if (!res.ok) {
      console.warn('[ai-background] Imagen API error:', res.status, await res.text());
      return null;
    }

    const result = await res.json() as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    const b64 = result.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
  } catch (e) {
    console.warn('[ai-background] failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

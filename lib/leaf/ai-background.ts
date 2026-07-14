/**
 * Gemini画像モデルを使ったリーフ背景画像生成
 *
 * 商品名と見積書から取得した商品画像を参考にしつつ、
 * 生成するのは背景のみ。商品画像・文字・価格はシステム側で後から合成する。
 */
import { GoogleGenAI } from '@google/genai';
import { getGeminiClient } from '../llm/gemini';
import { fetchWithTimeout, timeoutMsFromEnv, withTimeout } from '../async/timeout';
import type { LlmImageInput } from '../llm/types';

export type BgInput = {
  leafName: string;
  category: string;
  flavor: string;
  themeLabel: string;
  itemCount?: number;
  productNames?: string[];
  /** 見積書から取得した商品画像。Geminiのプロンプト生成にのみ添付し、Imagenには渡さない。 */
  productImages?: string[];
};

export const DEFAULT_IMAGE_GEN_MODEL = 'gemini-3.1-flash-lite-image';

type GeneratedImage = {
  type?: string;
  data?: string;
  mime_type?: string;
  mimeType?: string;
};

function cleanNames(names: string[] | undefined): string[] {
  return Array.from(new Set((names ?? []).map((n) => n.trim()).filter(Boolean)));
}

function isAssort(d: BgInput): boolean {
  return (d.itemCount ?? 1) >= 2 || cleanNames(d.productNames).length >= 2;
}

function mimeAllowed(mimeType: string): mimeType is LlmImageInput['mimeType'] {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType);
}

function dataUrlToImageInput(src: string): LlmImageInput | null {
  const match = src.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !mimeAllowed(match[1])) return null;
  return { mimeType: match[1], data: match[2] };
}

async function fetchImageInput(src: string): Promise<LlmImageInput | null> {
  const fromDataUrl = dataUrlToImageInput(src);
  if (fromDataUrl) return fromDataUrl;
  if (!/^https?:\/\//.test(src)) return null;

  try {
    const res = await fetchWithTimeout(
      src,
      { method: 'GET' },
      timeoutMsFromEnv('AI_BG_IMAGE_FETCH_TIMEOUT_MS', 8_000),
      'AI background product image fetch',
    );
    if (!res.ok) return null;
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!mimeAllowed(mimeType)) return null;
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { mimeType, data };
  } catch {
    return null;
  }
}

async function promptImageInputs(sources: string[] | undefined): Promise<LlmImageInput[]> {
  const inputs: LlmImageInput[] = [];
  for (const src of (sources ?? []).slice(0, 3)) {
    const input = await fetchImageInput(src);
    if (input) inputs.push(input);
  }
  return inputs;
}

export function buildAssortBackgroundMetaPrompt(d: BgInput): string {
  const names = cleanNames(d.productNames);
  const assort = isAssort(d);
  return `あなたはプロのビジュアルディレクターです。
日本のゲームセンター景品向け販促リーフレットの「背景だけ」を、Gemini画像モデルで生成するための英語プロンプトを作成してください。

【対象】
掲載品名: ${d.leafName}
${assort ? `アソート構成（${names.length || d.itemCount || 2}種）: ${(names.length ? names : [d.leafName]).join(' / ')}` : ''}
カテゴリ: ${d.category}
味・特徴・素材: ${d.flavor || '（特記なし）'}
想定テーマ: ${d.themeLabel}

【重要な前提】
- 商品画像、商品パッケージ、商品袋、箱、実在しない商品は後からシステムで合成するため、絶対に描かない。
- 日本語文字、英文字、数字、ロゴ、価格、商品コード、JAN、人物は一切描かない。
- キャッチコピーも後からシステムで重ねるため描かない。
- 下部には価格情報バーを重ねるため、下部15%には重要な装飾を置かない。
- 添付された商品画像がある場合は、色味・商品カテゴリ・雰囲気だけを参考にする。画像内の商品やパッケージは背景に再現しない。

【背景の考え方】
- 商品画像の配置は固定しない。中央配置、左寄せ、右寄せのどれでも使えるよう、画面全体に自然な余白と見せ場を分散させる。
- 片側だけに装飾を偏らせすぎない。
- 商品画像を置いても邪魔にならない明るい抜けを中央付近に作るが、露骨な空白にはしない。
- キャッチコピーを後から載せられる明るい余白を上部または右上周辺に自然に残す。
- 枠、白いカード、吹き出し、UI風の角丸ボックスは作らない。

【最重要: 商品名から具体的な着想を得ること】
- 下記のカテゴリ別の例はあくまで参考。カテゴリが「商品」など一般的にしか判定できていない場合や、
  カテゴリ例に当てはまらない商品（惣菜・肉・麺・米飯・珍味など）の場合は、
  必ず掲載品名（${d.leafName}）に含まれる具体的な食材名・調理法・シーンを直接読み取り、
  それに沿った世界観を発想すること。カテゴリ例をそのまま流用して無関係な雰囲気にしない。
- 例: 「から揚げ」「チキン」など揚げ物・肉料理系なら、湯気・香ばしい揚げ色・屋台や夜祭りの熱気など、
  食欲をそそる具体的なビジュアルにする。抽象的な色ストライプやパターンだけで済ませない。

${assort ? `【アソート背景の方針】
- 1つの商品だけを強く連想させず、複数種類が入った詰め合わせ感を背景で表現する。
- 構成商品の味・色・素材感をバランスよく散らす。
- 「いろいろ選べる」「一度に楽しめる」「にぎやか」な雰囲気を出す。
- 背景内に架空の詰め合わせ箱や商品パッケージを描かない。` : ''}

【出力形式】
英語のプロンプトのみ。60〜120単語程度。説明文は不要。`;
}

export function buildFallbackBackgroundPrompt(d: BgInput): string {
  const names = cleanNames(d.productNames);
  const assort = isAssort(d);
  const assortmentHint = assort
    ? `balanced assortment background inspired by ${names.join(', ') || d.leafName}, multiple flavors and textures distributed evenly, variety and abundance,`
    : `${d.flavor || d.category} inspired atmosphere,`;

  return [
    `${d.themeLabel} themed promotional background for a Japanese arcade prize leaflet,`,
    assortmentHint,
    'balanced composition with natural empty spaces for later product image and headline overlay,',
    'decorative motifs spread across the whole canvas without leaning heavily to one side,',
    'bright readable upper area, subtle open center, bottom 15 percent clean for an information bar,',
    'no product packaging, no product bag, no box, no fake product, no text, no numbers, no logo, no people,',
    'high quality, vibrant, 16:9 aspect ratio.',
  ].join(' ');
}

async function generateDynamicPrompt(d: BgInput): Promise<string> {
  const client = getGeminiClient();
  const images = await promptImageInputs(d.productImages);

  const systemPrompt = `${buildAssortBackgroundMetaPrompt(d)}

【カテゴリ別の例（参考。そのままコピーせず商品に合わせてアレンジすること）】
- 和菓子: Soft gold bokeh lights over dark textured washi paper, delicate matcha green powder floating, elegant Japanese aesthetic, warm amber tones.
- スナック: Exploding colorful popcorn and corn kernels against vivid yellow background, dynamic motion blur, pop art energy.
- フルーツゼリー: Crystal clear water droplets splashing around fresh sliced tropical fruits, vibrant jewel tones, refreshing summer vibe.
- チョコ・スイーツ: Melting dark chocolate drizzle over creamy pastel surface, scattered cocoa powder, luxurious and indulgent atmosphere, warm studio lighting.
- 塩系・いか: Ocean breeze aesthetic, crinkled metallic silver texture, scattered sea salt crystals, cool blue-gray palette.
- 飲料・さっぱり系: Sparkling water bubbles rising through clear blue, mint leaves and ice cubes floating, ultra-refreshing.
- チキン・から揚げ・焼き鳥などの肉料理系: Sizzling golden-fried chicken at a lively Japanese night festival food stall, warm paper lanterns and string lights, rising steam and charcoal smoke, glistening crispy texture, appetizing warm orange-red palette, bustling matsuri energy.
- たこ焼き・お好み焼き・粉物系: Steaming savory street food on a griddle, glossy sauce glaze, dancing bonito flakes, warm Japanese festival stall atmosphere, appetizing browns and reds.`;

  const userPrompt = `商品情報:
商品名: ${d.leafName}
${isAssort(d) ? `構成商品: ${cleanNames(d.productNames).join('、')}` : ''}
カテゴリ: ${d.category}
味・特徴・素材: ${d.flavor || '（特記なし）'}
想定テーマ: ${d.themeLabel}

この商品の販促リーフレット用の、魅力的で世界観のある背景ビジュアルを生成するための英語プロンプトを出力してください。
商品パッケージ本体・文字・人物は含めないでください。
${images.length > 0 ? '添付の商品画像は、色味・カテゴリ・雰囲気の参考にのみ使用してください。商品やパッケージを背景に再現しないでください。' : ''}`;

  try {
    const res = await withTimeout(
      client.generate(userPrompt, { systemPrompt, temperature: 0.85, images }),
      timeoutMsFromEnv('AI_PROMPT_TIMEOUT_MS', 15_000),
      'Gemini background prompt',
    );
    const prompt = res.text.trim();
    return `${prompt}, NO product packaging, NO text, NO numbers, NO people, high quality, 16:9 aspect ratio, promotional visual background.`;
  } catch (e) {
    console.warn('[ai-background] Gemini prompt generation failed, falling back.', e);
    return buildFallbackBackgroundPrompt(d);
  }
}

function outputImageFromInteraction(interaction: {
  output_image?: GeneratedImage;
  outputs?: Array<GeneratedImage | { type?: string; data?: string; mime_type?: string; mimeType?: string }>;
}): GeneratedImage | undefined {
  if (interaction.output_image?.data) return interaction.output_image;
  return interaction.outputs?.find((output) => output.type === 'image' && Boolean(output.data));
}

export async function generateBackground(input: BgInput): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = await generateDynamicPrompt(input);
  const model = process.env.IMAGE_GEN_MODEL ?? DEFAULT_IMAGE_GEN_MODEL;
  console.log(`[ai-background] Gemini image (${model}) Prompt: ${prompt}`);

  const ai = new GoogleGenAI({ apiKey });

  try {
    const interaction = await withTimeout(
      ai.interactions.create({
        model,
        input: prompt,
        response_modalities: ['image'],
      }),
      timeoutMsFromEnv('IMAGEN_TIMEOUT_MS', 45_000),
      'Gemini background image generation',
    );

    const image = outputImageFromInteraction(interaction);
    if (!image?.data) return null;
    return Buffer.from(image.data, 'base64');
  } catch (e) {
    console.warn('[ai-background] failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

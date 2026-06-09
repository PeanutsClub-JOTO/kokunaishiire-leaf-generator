/**
 * Gemini LlmClient 実装
 *
 * モデル名は環境変数 LLM_MODEL で指定（既定: gemini-2.0-flash）。
 * JSON Schema 指定時は responseSchema に渡して構造化出力を取得する。
 */
import {
  GoogleGenerativeAI,
  type GenerateContentRequest,
  type Part,
  SchemaType,
} from '@google/generative-ai';
import type { LlmClient, LlmGenerateOptions, LlmGenerateResult } from './types';

export class GeminiClient implements LlmClient {
  private ai: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set');
    this.ai = new GoogleGenerativeAI(key);
    this.modelName = process.env.LLM_MODEL ?? 'gemini-2.0-flash';
  }

  async generate(
    prompt: string,
    options: LlmGenerateOptions = {},
  ): Promise<LlmGenerateResult> {
    const model = this.ai.getGenerativeModel({
      model: this.modelName,
      systemInstruction: options.systemPrompt,
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        ...(options.responseSchema
          ? {
              responseMimeType: 'application/json',
              responseSchema: options.responseSchema as any,
            }
          : {}),
      },
    });

    const parts: Part[] = [];

    // 画像入力
    if (options.images) {
      for (const img of options.images) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        });
      }
    }

    parts.push({ text: prompt });

    const request: GenerateContentRequest = { contents: [{ role: 'user', parts }] };
    const result = await model.generateContent(request);
    const text = result.response.text();

    let parsed: unknown;
    if (options.responseSchema) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    return { text, parsed };
  }
}

/** シングルトンファクトリ（サーバサイドで使い回す） */
let _client: GeminiClient | null = null;

export function getGeminiClient(): GeminiClient {
  if (!_client) _client = new GeminiClient();
  return _client;
}

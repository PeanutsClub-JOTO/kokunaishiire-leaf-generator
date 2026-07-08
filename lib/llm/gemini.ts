/**
 * Gemini LlmClient 実装
 *
 * モデル名は環境変数 LLM_MODEL で指定（既定: gemini-3.1-flash-lite）。
 * JSON Schema 指定時は responseSchema に渡して構造化出力を取得する。
 * AQ. 形式の新しい Auth キーに対応するため @google/genai SDK を使用。
 */
import { GoogleGenAI } from '@google/genai';
import type { LlmClient, LlmGenerateOptions, LlmGenerateResult } from './types';

export const DEFAULT_LLM_MODEL = 'gemini-3.1-flash-lite';

export class GeminiClient implements LlmClient {
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set');
    this.ai = new GoogleGenAI({ apiKey: key });
    this.modelName = process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
  }

  async generate(
    prompt: string,
    options: LlmGenerateOptions = {},
  ): Promise<LlmGenerateResult> {
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

    const userParts: Array<Record<string, unknown>> = [];

    if (options.images) {
      for (const img of options.images) {
        userParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }
    userParts.push({ text: prompt });
    contents.push({ role: 'user', parts: userParts });

    const config: Record<string, unknown> = {
      temperature: options.temperature ?? 0.2,
    };

    if (options.systemPrompt) {
      config.systemInstruction = options.systemPrompt;
    }

    if (options.responseSchema) {
      config.responseMimeType = 'application/json';
      config.responseSchema = options.responseSchema;
    }

    const response = await this.ai.models.generateContent({
      model: this.modelName,
      contents,
      config,
    });

    const text = response.text ?? '';

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

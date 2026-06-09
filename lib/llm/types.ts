/**
 * LlmClient 抽象インターフェース
 *
 * プロバイダ（Gemini/Claude等）を差し替え可能にする抽象レイヤー。
 * 環境変数 LLM_MODEL で切替。
 */

export type LlmMessage = {
  role: 'user' | 'model';
  content: string;
};

export type LlmImageInput = {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf';
  data: string; // base64エンコード
};

export type LlmGenerateOptions = {
  systemPrompt?: string;
  images?: LlmImageInput[];
  responseSchema?: object; // JSON Schema
  temperature?: number;
};

export type LlmGenerateResult = {
  text: string;
  /** JSON Schemaを指定した場合はパース済みオブジェクト */
  parsed?: unknown;
};

export interface LlmClient {
  generate(
    prompt: string,
    options?: LlmGenerateOptions,
  ): Promise<LlmGenerateResult>;
}

import { describe, it, expect, vi } from 'vitest';
import { checkVariantCompatibility } from './ai-assist';
import { getGeminiClient } from '../llm/gemini';

// getGeminiClient をモック化
vi.mock('../llm/gemini', () => ({
  getGeminiClient: vi.fn(),
}));

describe('checkVariantCompatibility', () => {
  it('商品名が1つ未満の場合は判定不要で通過する', async () => {
    const res = await checkVariantCompatibility(['単品の商品']);
    expect(res.isNaturalVariant).toBe(true);
    expect(res.confidence).toBe(1.0);
    expect(res.reason).toContain('単品');
  });

  it('味違いと判定されるケース', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: '{"isNaturalVariant":true,"confidence":0.9,"reason":"味違いの自然な組み合わせ"}',
      parsed: {
        isNaturalVariant: true,
        confidence: 0.9,
        reason: '味違いの自然な組み合わせ'
      }
    });
    
    vi.mocked(getGeminiClient).mockReturnValue({
      generate: mockGenerate
    } as any);

    const res = await checkVariantCompatibility(['YL-6P塩レモン', 'YL-6Pいちご']);
    
    expect(mockGenerate).toHaveBeenCalled();
    expect(res.isNaturalVariant).toBe(true);
    expect(res.confidence).toBe(0.9);
  });

  it('不自然と判定されるケース', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: '{"isNaturalVariant":false,"confidence":0.85,"reason":"商品カテゴリが異なる"}',
      parsed: {
        isNaturalVariant: false,
        confidence: 0.85,
        reason: '商品カテゴリが異なる'
      }
    });
    
    vi.mocked(getGeminiClient).mockReturnValue({
      generate: mockGenerate
    } as any);

    const res = await checkVariantCompatibility(['ゼリー', 'せんべい']);
    
    expect(mockGenerate).toHaveBeenCalled();
    expect(res.isNaturalVariant).toBe(false);
    expect(res.confidence).toBe(0.85);
  });

  it('パース失敗時はデフォルト通過（AI判定不能）となる', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: 'I cannot answer this',
      parsed: undefined
    });
    
    vi.mocked(getGeminiClient).mockReturnValue({
      generate: mockGenerate
    } as any);

    const res = await checkVariantCompatibility(['商品A', '商品B']);
    
    expect(res.isNaturalVariant).toBe(true); // default
    expect(res.confidence).toBe(0.5);
    expect(res.reason).toContain('AI判定不能');
  });
});

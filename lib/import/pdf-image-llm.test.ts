import { describe, it, expect, vi } from 'vitest';
import { extractFromImagePdf } from './pdf-image-llm';
import { getGeminiClient } from '../llm/gemini';

vi.mock('../llm/gemini', () => ({
  getGeminiClient: vi.fn(),
}));

describe('extractFromImagePdf', () => {
  it('Geminiから構造化された商品データを抽出できる', async () => {
    const mockParsed = {
      confidence: 0.9,
      products: [
        {
          no: 1,
          maker_name: 'テストメーカー',
          product_name: 'テスト商品',
          spec_raw: '10個',
          irisu_raw: '10x2',
          min_lot_raw: '1ケース',
          retail_price: 1000,
          cost: 500,
          jan_code: '4500000000000',
          shelf_life_raw: '100日',
          sales_period_raw: '2026.01.01〜2026.12.31',
          note: ''
        }
      ]
    };

    const mockGenerate = vi.fn().mockResolvedValue({
      text: JSON.stringify(mockParsed),
      parsed: mockParsed
    });

    vi.mocked(getGeminiClient).mockReturnValue({
      generate: mockGenerate
    } as any);

    const res = await extractFromImagePdf('base64dummydata', 'image/jpeg');

    expect(mockGenerate).toHaveBeenCalled();
    expect(res.confidence).toBe(0.9);
    expect(res.products).toHaveLength(1);
    expect(res.products[0].product_name).toBe('テスト商品');
  });

  it('パース失敗時は空配列を返す', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: 'エラー',
      parsed: undefined
    });

    vi.mocked(getGeminiClient).mockReturnValue({
      generate: mockGenerate
    } as any);

    const res = await extractFromImagePdf('base64dummydata');

    expect(res.confidence).toBe(0);
    expect(res.products).toHaveLength(0);
  });
});

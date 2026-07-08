import { describe, expect, it } from 'vitest';
import {
  buildAssortBackgroundMetaPrompt,
  buildFallbackBackgroundPrompt,
  DEFAULT_IMAGE_GEN_MODEL,
  type BgInput,
} from './ai-background';
import { DEFAULT_LLM_MODEL } from '../llm/gemini';

const assortInput: BgInput = {
  leafName: '珈琲ゼリー・マンゴープリンギフト',
  category: 'ゼリー',
  flavor: '珈琲、マンゴー、プリン、ギフト',
  themeLabel: 'フルーツ',
  itemCount: 2,
  productNames: ['珈琲ゼリー', 'マンゴープリン'],
};

describe('ai-background prompt builders', () => {
  it('文章生成と画像生成は安価な別モデルを既定値にする', () => {
    expect(DEFAULT_LLM_MODEL).toBe('gemini-3.1-flash-lite');
    expect(DEFAULT_IMAGE_GEN_MODEL).toBe('gemini-3.1-flash-lite-image');
  });

  it('アソート背景用のメタプロンプトに構成商品と禁止事項を含める', () => {
    const prompt = buildAssortBackgroundMetaPrompt(assortInput);

    expect(prompt).toContain('アソート構成');
    expect(prompt).toContain('珈琲ゼリー / マンゴープリン');
    expect(prompt).toContain('商品画像の配置は固定しない');
    expect(prompt).toContain('片側だけに装飾を偏らせすぎない');
    expect(prompt).toContain('キャッチコピーも後からシステムで重ねる');
    expect(prompt).toContain('添付された商品画像');
    expect(prompt).toContain('色味・商品カテゴリ・雰囲気だけを参考');
    expect(prompt).toContain('商品パッケージ');
    expect(prompt).toContain('文字、数字、ロゴ');
  });

  it('フォールバックプロンプトもアソートの複数感と後合成制約を維持する', () => {
    const prompt = buildFallbackBackgroundPrompt(assortInput);

    expect(prompt).toContain('balanced assortment background');
    expect(prompt).toContain('珈琲ゼリー, マンゴープリン');
    expect(prompt).toContain('later product image and headline overlay');
    expect(prompt).toContain('without leaning heavily to one side');
    expect(prompt).toContain('no product packaging');
    expect(prompt).toContain('no text');
  });

  it('単品ではアソート構成セクションを出さない', () => {
    const prompt = buildAssortBackgroundMetaPrompt({
      leafName: '岡山白桃カステラ',
      category: 'カステラ',
      flavor: '白桃',
      themeLabel: 'スイーツ',
      itemCount: 1,
      productNames: ['岡山白桃カステラ'],
    });

    expect(prompt).not.toContain('アソート構成');
    expect(prompt).toContain('掲載品名: 岡山白桃カステラ');
  });
});

import { describe, expect, it } from 'vitest';
import {
  detectQuotationSourceType,
  quotationUploadContentType,
  safeQuotationStorageName,
} from './quotation-file';

describe('quotation-file storage helpers', () => {
  it('日本語や記号を含むファイル名をStorageで安全な名前に変換する', () => {
    const name = safeQuotationStorageName('お見積書（ピーナッツクラブ様2026.4.28） (3).xlsx', 12345);

    expect(name).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(name).toBe('2026.4.28-3-12345.xlsx');
  });

  it('対応拡張子だけを取込対象にする', () => {
    expect(detectQuotationSourceType('quote.pdf')).toBe('pdf');
    expect(detectQuotationSourceType('quote.xlsx')).toBe('xlsx');
    expect(detectQuotationSourceType('quote.xls')).toBe('xlsx');
    expect(detectQuotationSourceType('quote.csv')).toBeNull();
  });

  it('拡張子ごとにアップロードContent-Typeを返す', () => {
    expect(quotationUploadContentType('quote.pdf')).toBe('application/pdf');
    expect(quotationUploadContentType('quote.xls')).toBe('application/vnd.ms-excel');
    expect(quotationUploadContentType('quote.xlsx')).toContain('spreadsheetml.sheet');
  });
});

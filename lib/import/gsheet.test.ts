import { describe, it, expect } from 'vitest';
import { extractSpreadsheetId } from './gsheet';

describe('extractSpreadsheetId', () => {
  it('URLからスプレッドシートIDを抽出できる', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRYNzOQ/edit#gid=0';
    const id = extractSpreadsheetId(url);
    expect(id).toBe('1BxiMVs0XRYNzOQ');
  });

  it('すでにIDの場合はそのまま返す', () => {
    const idStr = '1BxiMVs0XRYNzOQ';
    const id = extractSpreadsheetId(idStr);
    expect(id).toBe('1BxiMVs0XRYNzOQ');
  });
});

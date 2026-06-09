/**
 * PDF表抽出 (仕様書 v2.1 §9b)
 *
 * pdfplumber Python sidecar (scripts/pdf_extract.py) を
 * child_process.execFile で呼び出して表データをJSONで受け取る。
 *
 * 表構造が保たれたPDF（テキストPDF）に対して使用。
 * 画像PDF/崩れ帳票は pdf-image-llm.ts を使う。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export type PdfPage = {
  page_number: number;
  tables: string[][][]; // tables[tableIndex][rowIndex][colIndex]
};

export type PdfExtractResult = {
  pages: PdfPage[];
  error: string | null;
};

/**
 * PDFバッファから表を抽出する
 *
 * @param pdfBuffer PDFファイルのバイナリ
 * @returns 全ページの表データ
 */
export async function extractPdfTables(
  pdfBuffer: Buffer,
): Promise<PdfExtractResult> {
  // 一時ファイルに書き出す
  const tmpPath = path.join(os.tmpdir(), `pdf_extract_${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, pdfBuffer);

  try {
    const scriptPath = path.join(process.cwd(), 'scripts/pdf_extract.py');
    const { stdout, stderr } = await execFileAsync('python3', [scriptPath, tmpPath], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (stderr) {
      console.warn('[pdf-table] python stderr:', stderr);
    }

    const result = JSON.parse(stdout) as PdfExtractResult;
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { pages: [], error: `PDF extraction failed: ${message}` };
  } finally {
    // 一時ファイルを削除
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

/**
 * pdfplumber が利用可能かチェック
 */
export async function checkPdfplumber(): Promise<boolean> {
  try {
    await execFileAsync('python3', ['-c', 'import pdfplumber; print("ok")'], {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

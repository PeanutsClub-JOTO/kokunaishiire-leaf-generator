export type QuotationUploadSourceType = 'xlsx' | 'pdf';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_CONTENT_TYPE = 'application/vnd.ms-excel';

function extensionOf(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ext || 'xlsx';
}

export function detectQuotationSourceType(fileName: string): QuotationUploadSourceType | null {
  const ext = extensionOf(fileName);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return null;
}

export function safeQuotationStorageName(originalName: string, now = Date.now()): string {
  const ext = extensionOf(originalName);
  const rawBase = originalName.replace(/\.[^.]+$/, '').normalize('NFKC');
  const safeBase =
    rawBase
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 60) || 'quotation';

  return `${safeBase}-${now}.${ext}`;
}

export function quotationUploadContentType(fileName: string): string {
  const ext = extensionOf(fileName);
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'xls') return XLS_CONTENT_TYPE;
  return XLSX_CONTENT_TYPE;
}

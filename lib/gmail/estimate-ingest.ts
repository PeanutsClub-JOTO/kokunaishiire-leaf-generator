import { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import type { Database } from '../supabase/types';
import {
  detectQuotationSourceType,
  quotationUploadContentType,
  safeQuotationStorageName,
} from '../storage/quotation-file';

type Supabase = SupabaseClient<Database>;

export type GmailEstimateAttachmentInput = {
  fileName: string;
  mimeType?: string | null;
  base64: string;
};

export type GmailEstimateMessageInput = {
  gmailMessageId: string;
  gmailThreadId?: string | null;
  subject?: string | null;
  fromAddress?: string | null;
  receivedAt?: string | null;
  snippet?: string | null;
  rawEmlBase64?: string | null;
  attachments?: GmailEstimateAttachmentInput[];
};

export type GmailEstimateIngestResult = {
  messageId: string;
  archivedFiles: number;
  queuedImportJobs: number;
  unsupportedFiles: number;
  skippedFiles: number;
};

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
}

function safeFolderName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80) || 'gmail-message';
}

function decodeBase64(input: string): Buffer {
  const cleaned = input.includes(',') ? input.split(',').pop() ?? '' : input;
  return Buffer.from(cleaned, 'base64');
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function attachmentKind(fileName: string): 'quotation' | 'eml' | 'unsupported' {
  const ext = extensionOf(fileName);
  if (ext === 'xlsx' || ext === 'xls' || ext === 'pdf') return 'quotation';
  if (ext === 'eml') return 'eml';
  return 'unsupported';
}

async function uploadArchiveFile(
  supabase: Supabase,
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from('gmail-estimates')
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Gmail archive upload failed: ${error.message}`);
}

async function createQuotationFromAttachment(
  supabase: Supabase,
  messageId: string,
  originalName: string,
  buffer: Buffer,
): Promise<{ quotationId: string; jobId: string }> {
  const sourceType = detectQuotationSourceType(originalName);
  if (!sourceType) throw new Error(`Unsupported quotation file: ${originalName}`);

  const safeName = safeQuotationStorageName(originalName);
  const { data: quotation, error: qErr } = await supabase
    .from('quotations')
    .insert({
      source_type: sourceType,
      source_ref: safeName,
      client_name: 'ピーナッツクラブ',
    })
    .select()
    .single();
  if (qErr || !quotation) throw new Error(`Quotation insert failed: ${qErr?.message}`);

  const quotationPath = `quotations/${quotation.id}/${safeName}`;
  const { error: storageErr } = await supabase.storage
    .from('quotation-files')
    .upload(quotationPath, buffer, {
      contentType: quotationUploadContentType(originalName),
      upsert: true,
    });
  if (storageErr) {
    await supabase.from('quotations').delete().eq('id', quotation.id);
    throw new Error(`Quotation file upload failed: ${storageErr.message}`);
  }

  const jobType = sourceType === 'pdf' ? 'import_pdf' : 'import_xlsx';
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      quotation_id: quotation.id,
      job_type: jobType,
      status: 'queued',
    })
    .select()
    .single();
  if (jobErr || !job) throw new Error(`Import job insert failed: ${jobErr?.message}`);

  console.log(`[gmail-ingest] queued ${jobType} from Gmail message ${messageId}: ${originalName}`);
  return { quotationId: quotation.id, jobId: job.id };
}

export async function ingestGmailEstimateMessage(
  supabase: Supabase,
  input: GmailEstimateMessageInput,
): Promise<GmailEstimateIngestResult> {
  if (!input.gmailMessageId) throw new Error('gmailMessageId is required');

  const folder = safeFolderName(input.gmailMessageId);
  const receivedAt = input.receivedAt ?? new Date().toISOString();

  const { data: message, error: msgErr } = await supabase
    .from('gmail_estimate_messages')
    .upsert(
      {
        gmail_message_id: input.gmailMessageId,
        gmail_thread_id: input.gmailThreadId ?? null,
        subject: input.subject ?? null,
        from_address: input.fromAddress ?? null,
        received_at: receivedAt,
        snippet: input.snippet ?? null,
        archive_storage_prefix: `messages/${folder}`,
        status: 'archived',
      },
      { onConflict: 'gmail_message_id' },
    )
    .select()
    .single();
  if (msgErr || !message) throw new Error(`Gmail message upsert failed: ${msgErr?.message}`);

  let archivedFiles = 0;
  let queuedImportJobs = 0;
  let unsupportedFiles = 0;
  let skippedFiles = 0;

  if (input.rawEmlBase64) {
    await uploadArchiveFile(
      supabase,
      `messages/${folder}/raw.eml`,
      decodeBase64(input.rawEmlBase64),
      'message/rfc822',
    );
    archivedFiles++;
  }

  for (const attachment of input.attachments ?? []) {
    const kind = attachmentKind(attachment.fileName);
    const safeName = safeQuotationStorageName(attachment.fileName);
    const storagePath = `messages/${folder}/attachments/${safeName}`;
    const buffer = decodeBase64(attachment.base64);
    const fileSha256 = sha256(buffer);
    const contentType =
      attachment.mimeType ||
      (kind === 'quotation'
        ? quotationUploadContentType(attachment.fileName)
        : kind === 'eml'
          ? 'message/rfc822'
          : 'application/octet-stream');

    const { data: existingFile, error: existingErr } = await supabase
      .from('gmail_estimate_files')
      .select('id')
      .eq('message_id', message.id)
      .eq('file_sha256', fileSha256)
      .limit(1)
      .maybeSingle();
    if (existingErr) throw new Error(`Gmail duplicate check failed: ${existingErr.message}`);
    if (existingFile) {
      skippedFiles++;
      continue;
    }

    await uploadArchiveFile(supabase, storagePath, buffer, contentType);
    archivedFiles++;

    let quotationId: string | null = null;
    let jobId: string | null = null;
    let status: Database['public']['Tables']['gmail_estimate_files']['Insert']['status'] = 'archived';

    if (kind === 'quotation') {
      const queued = await createQuotationFromAttachment(
        supabase,
        input.gmailMessageId,
        attachment.fileName,
        buffer,
      );
      quotationId = queued.quotationId;
      jobId = queued.jobId;
      status = 'queued';
      queuedImportJobs++;
    } else if (kind === 'eml') {
      status = 'archived';
    } else {
      status = 'unsupported';
      unsupportedFiles++;
    }

    const { error: fileErr } = await supabase.from('gmail_estimate_files').insert({
      message_id: message.id,
      file_name: attachment.fileName,
      file_sha256: fileSha256,
      mime_type: contentType,
      storage_path: storagePath,
      file_kind: kind,
      quotation_id: quotationId,
      import_job_id: jobId,
      status,
    });
    if (fileErr) throw new Error(`Gmail file insert failed: ${fileErr.message}`);
  }

  return {
    messageId: message.id,
    archivedFiles,
    queuedImportJobs,
    unsupportedFiles,
    skippedFiles,
  };
}

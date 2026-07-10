import { google } from 'googleapis';
import { Readable } from 'stream';

export type DriveUploadResult = {
  fileId: string;
  webViewLink: string | null;
  webContentLink: string | null;
};

function getDriveAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  // Vercel/Railway では改行がリテラル "\\n" として格納される場合がある
  const key = rawKey?.replace(/\\n/g, '\n');

  console.log('[drive-env]', {
    email: Boolean(email),
    privateKey: Boolean(key),
    keyLength: key?.length ?? 0,
    folderId: Boolean(process.env.GOOGLE_DRIVE_FINAL_LEAF_FOLDER_ID),
  });

  const missing: string[] = [];
  if (!email) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!key) missing.push('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  if (missing.length > 0) {
    throw new Error(`環境変数が未設定です: ${missing.join(', ')}。Vercelの環境変数設定を確認してください。`);
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

export function getFinalLeafletDriveFolderId(): string {
  const folderId = process.env.GOOGLE_DRIVE_FINAL_LEAF_FOLDER_ID;
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FINAL_LEAF_FOLDER_ID must be set');
  }
  return folderId;
}

export function sanitizeDriveFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'leaflet';
}

export async function uploadImageUrlToDrive(params: {
  imageUrl: string;
  fileName: string;
  folderId?: string;
}): Promise<DriveUploadResult> {
  const auth = getDriveAuth();
  const drive = google.drive({ version: 'v3', auth });
  const folderId = params.folderId ?? getFinalLeafletDriveFolderId();

  // 転送先フォルダが共有ドライブ内か判定（サービスアカウントにはストレージ容量がないため必須）
  let driveId: string | undefined;
  try {
    const folderMeta = await drive.files.get({
      fileId: folderId,
      fields: 'driveId',
      supportsAllDrives: true,
    });
    driveId = folderMeta.data.driveId ?? undefined;
    console.log('[drive-upload] folder driveId:', driveId ?? '(マイドライブ)');
  } catch (err) {
    console.warn('[drive-upload] フォルダ情報の取得に失敗:', err);
  }

  if (!driveId) {
    throw new Error(
      '転送先フォルダが共有ドライブ内にありません。' +
      'サービスアカウントにはストレージ容量がないため、共有ドライブ（Shared Drive）内のフォルダを指定してください。' +
      ' GOOGLE_DRIVE_FINAL_LEAF_FOLDER_ID を共有ドライブ内のフォルダIDに変更してください。',
    );
  }

  const imageRes = await fetch(params.imageUrl);
  if (!imageRes.ok) {
    throw new Error(`Leaflet image download failed: ${imageRes.status} ${imageRes.statusText}`);
  }

  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const fileName = sanitizeDriveFileName(params.fileName.endsWith('.png') ? params.fileName : `${params.fileName}.png`);

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'image/png',
      driveId,
    },
    media: {
      mimeType: 'image/png',
      body: Readable.from(buffer),
    },
    fields: 'id, webViewLink, webContentLink',
    supportsAllDrives: true,
  });

  const fileId = created.data.id;
  if (!fileId) {
    throw new Error('Google Drive upload succeeded without file id');
  }

  return {
    fileId,
    webViewLink: created.data.webViewLink ?? null,
    webContentLink: created.data.webContentLink ?? null,
  };
}

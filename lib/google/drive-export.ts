import { google } from 'googleapis';
import { Readable } from 'stream';

export type DriveUploadResult = {
  fileId: string;
  webViewLink: string | null;
  webContentLink: string | null;
};

function getDriveAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY must be set');
  }

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key,
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
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

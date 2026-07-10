/**
 * POST /api/leaflets/[id]/finalize
 *
 * リーフを正式確定し、確定リーフ一覧へ3日間表示し、
 * Google Driveへ直接転送する（ワーカー不要）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/types';
import { sanitizeDriveFileName, uploadImageUrlToDrive } from '@/lib/google/drive-export';

type FinalizeBody = {
  product_code?: string;
  pj_no?: string;
  leaf_name?: string;
  lead_time?: string;
  note?: string;
  main_copy_override?: string | null;
  assort_followup_status?: 'unasked' | 'not_needed' | 'accepted' | 'declined';
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<unknown> },
) {
  const supabase = createServerClient();
  const { id } = await params as { id: string };
  const body = await req.json().catch(() => ({})) as FinalizeBody;

  const { data: current, error: currentErr } = await supabase
    .from('leaflets')
    .select('id, leaf_image_url, render_status, status, product_code, leaf_name')
    .eq('id', id)
    .single();

  if (currentErr || !current) {
    return NextResponse.json({ error: currentErr?.message ?? 'Leaflet not found' }, { status: 404 });
  }
  if (!current.leaf_image_url) {
    return NextResponse.json(
      { error: 'リーフ画像がまだ生成されていません。画像生成後に確定してください。' },
      { status: 422 },
    );
  }

  const now = new Date();
  const visibleUntil = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const update: Database['public']['Tables']['leaflets']['Update'] = {
    status: 'final',
    finalized_at: now.toISOString(),
    final_visible_until: visibleUntil.toISOString(),
    drive_export_status: 'exporting',
    drive_export_error: null,
    updated_at: now.toISOString(),
    assort_followup_status: body.assort_followup_status ?? 'unasked',
  };
  if (body.leaf_name !== undefined) update.leaf_name = body.leaf_name;
  if (body.lead_time !== undefined) update.lead_time = body.lead_time;
  if (body.note !== undefined) update.note = body.note;
  if (body.main_copy_override !== undefined) update.main_copy_override = body.main_copy_override;
  if (body.product_code !== undefined) update.product_code = body.product_code;
  if (body.pj_no !== undefined) update.pj_no = body.pj_no;

  const { data: leaflet, error: updateErr } = await supabase
    .from('leaflets')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Drive転送を直接実行（ワーカーに委譲せず、Vercel環境変数で完結）
  try {
    const leafName = body.leaf_name ?? current.leaf_name ?? '';
    const baseName = sanitizeDriveFileName(
      [current.product_code, leafName, id.slice(0, 8)].filter(Boolean).join('_'),
    );

    const result = await uploadImageUrlToDrive({
      imageUrl: current.leaf_image_url,
      fileName: `${baseName}.png`,
    });

    await supabase
      .from('leaflets')
      .update({
        drive_file_id: result.fileId,
        drive_url: result.webViewLink ?? result.webContentLink,
        drive_export_status: 'done',
        drive_export_error: null,
      })
      .eq('id', id);

    return NextResponse.json({
      leaflet: {
        ...leaflet,
        drive_file_id: result.fileId,
        drive_url: result.webViewLink ?? result.webContentLink,
        drive_export_status: 'done',
      },
      drive_done: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[finalize] Drive転送エラー:', message);

    await supabase
      .from('leaflets')
      .update({ drive_export_status: 'error', drive_export_error: message })
      .eq('id', id);

    return NextResponse.json({
      leaflet,
      drive_error: message,
    });
  }
}

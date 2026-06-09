/**
 * POST /api/leaflets/[id]/pdf — リーフPDF生成
 *
 * ワーカーにリクエストを委譲してPDFを生成し、Storage に保存する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { generateLeafPdf } from '@/lib/leaf/generate-pdf';
import { loadLeafletPdfData } from '@/lib/leaf/load-data';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createServerClient();
  const { id } = await params;

  const { data: leaflet } = await supabase
    .from('leaflets')
    .select('*, assort_groups(sheet_id)')
    .eq('id', id)
    .single();

  if (!leaflet) {
    return NextResponse.json({ error: 'Leaflet not found' }, { status: 404 });
  }

  try {
    const leafData = await loadLeafletPdfData(supabase, leaflet.id);
    const { buffer } = await generateLeafPdf(leafData);

    const storagePath = `leaflets/${leaflet.id}/${leaflet.status}_${Date.now()}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('leaflet-pdfs')
      .upload(storagePath, buffer, { contentType: 'application/pdf' });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage
      .from('leaflet-pdfs')
      .getPublicUrl(storagePath);

    // pdf_url を更新
    await supabase
      .from('leaflets')
      .update({ pdf_url: urlData.publicUrl })
      .eq('id', id);

    return NextResponse.json({ pdf_url: urlData.publicUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

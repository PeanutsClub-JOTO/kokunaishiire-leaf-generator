/**
 * DELETE /api/quotations/[id] — 見積書とその全関連データを完全削除
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/client';
import { deleteQuotationFull } from '@/lib/quotation/delete';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createServerClient();
  const { id } = await params;

  const result = await deleteQuotationFull(supabase, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Job } from '../../lib/supabase/types';
import { loadLeafletImageData } from '../../lib/leaf/load-data';
import { renderLeafImageBuffer } from '../leaf-renderer/render';
import { generateCatchphrase } from '../../lib/leaf/ai-catchphrase';
import { generateBackground } from '../../lib/leaf/ai-background';
import { selectLeafTheme, detectCategory, flavorOf } from '../../lib/leaf/generate-image';

export async function handleRenderLeafletImage(
  job: Job,
  supabase: SupabaseClient<Database>,
): Promise<void> {
  if (!job.target_id) {
    throw new Error('render_leaflet_image job requires target_id');
  }

  await supabase
    .from('leaflets')
    .update({ render_status: 'rendering', render_error: null })
    .eq('id', job.target_id);

  const leafData = await loadLeafletImageData(supabase, job.target_id);

  // AI生成（失敗してもルールベースにフォールバック）
  const theme = selectLeafTheme(leafData);
  const category = detectCategory(leafData.leafName);
  const flavor = flavorOf(leafData.leafName);

  // 背景は一度良いものが生成されたら使い回す。テキスト編集の保存のたびに
  // ランダムな新しい背景に置き換わってしまうと、せっかく気に入った背景が
  // 消えてしまうため、既存の ai_background_url がある場合は再生成しない。
  const hasExistingBackground = Boolean(leafData.aiBackgroundUrl);
  // AI背景生成（Gemini画像モデル）はコストが高いため既定オプトアウト。
  // 取込画面のチェックON、またはワークベンチの「背景を生成」ボタン経由で
  // leaflets.ai_background_enabled が true になったときだけ試みる。
  const shouldAttemptBackground = Boolean(leafData.aiBackgroundEnabled) && !hasExistingBackground;

  const [freshCatchphrase, bgBuffer] = await Promise.all([
    generateCatchphrase({
      leafName: leafData.leafName,
      category,
      flavor,
      itemCount: leafData.itemCount,
      note: leafData.note,
      leadTime: leafData.leadTime,
    }),
    shouldAttemptBackground
      ? generateBackground({
          leafName: leafData.leafName,
          category,
          flavor,
          themeLabel: theme.label,
          itemCount: leafData.itemCount,
          productNames: leafData.productNames,
          // AI背景の入力にはURLのみ渡す（拡大率・位置の調整値は不要）
          productImages: leafData.productImages.map((p) => (typeof p === 'string' ? p : p.url)),
        })
      : Promise.resolve(null),
  ]);

  // 新規生成に成功したらDBへ保存（ワークベンチの編集欄初期値になる）。
  // 失敗時は前回保存分（loadLeafletImageDataがcatchphraseに載せてくる）を使う。
  const catchphrase = freshCatchphrase ?? leafData.catchphrase ?? null;
  if (freshCatchphrase) {
    await supabase
      .from('leaflets')
      .update({ ai_main_copy: freshCatchphrase.main_copy, ai_sub_copy: freshCatchphrase.sub_copy })
      .eq('id', job.target_id);
  }

  // 既存背景があればそのURLをそのまま再利用し、Storageへの再アップロードも行わない。
  const aiBgDataUrl = bgBuffer
    ? `data:image/png;base64,${bgBuffer.toString('base64')}`
    : leafData.aiBackgroundUrl ?? null;
  // 背景生成を試みていない（オプトアウト）場合は「失敗」ではないので警告は出さない。
  const renderWarning =
    bgBuffer || hasExistingBackground || !shouldAttemptBackground
      ? null
      : 'AI背景生成に失敗、またはAPIキー未設定のため、通常背景で生成しました。';

  let aiBackgroundUrl: string | null = hasExistingBackground ? leafData.aiBackgroundUrl ?? null : null;
  if (bgBuffer) {
    const bgStoragePath = `leaflets/${job.target_id}/background_${Date.now()}.png`;
    const { error: bgUploadErr } = await supabase.storage
      .from('leaflet-images')
      .upload(bgStoragePath, bgBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (bgUploadErr) {
      console.warn('[worker] AI背景画像の保存に失敗しました:', bgUploadErr.message);
    } else {
      const { data: bgUrlData } = supabase.storage
        .from('leaflet-images')
        .getPublicUrl(bgStoragePath);
      aiBackgroundUrl = bgUrlData.publicUrl;
    }
  }

  const png = await renderLeafImageBuffer({ ...leafData, catchphrase, aiBgDataUrl });
  const storagePath = `leaflets/${job.target_id}/${leafData.status}_${Date.now()}.png`;

  const { error: uploadErr } = await supabase.storage
    .from('leaflet-images')
    .upload(storagePath, png, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadErr) {
    await supabase
      .from('leaflets')
      .update({ render_status: 'error', render_error: uploadErr.message })
      .eq('id', job.target_id);
    throw uploadErr;
  }

  const { data: urlData } = supabase.storage
    .from('leaflet-images')
    .getPublicUrl(storagePath);

  const update: Database['public']['Tables']['leaflets']['Update'] = {
    leaf_image_url: urlData.publicUrl,
    render_status: 'done',
    render_error: renderWarning,
    template_version: 'leaf-image-v1',
  };
  if (aiBackgroundUrl) update.ai_background_url = aiBackgroundUrl;
  // ai_background_enabled は「次のレンダー1回だけ生成を試みる」ための一回限りのフラグ。
  // 成功/失敗にかかわらずここで必ず false に戻し、以後の「情報を保存」など
  // 通常の再レンダリングでは二度と自動でGeminiを呼ばないようにする。
  if (shouldAttemptBackground) update.ai_background_enabled = false;

  const { error: updateErr } = await supabase
    .from('leaflets')
    .update(update)
    .eq('id', job.target_id);

  if (updateErr && aiBackgroundUrl) {
    console.warn('[worker] AI背景URLの保存に失敗しました。背景URLなしで更新します:', updateErr.message);
    const fallbackUpdate = { ...update };
    delete fallbackUpdate.ai_background_url;
    const { error: fallbackErr } = await supabase
      .from('leaflets')
      .update(fallbackUpdate)
      .eq('id', job.target_id);
    if (fallbackErr) throw fallbackErr;
  } else if (updateErr) {
    throw updateErr;
  }
}

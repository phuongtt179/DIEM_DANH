import { supabase } from '@/lib/supabase';
import type { WpEvent } from '@/lib/work';

export const maxDuration = 15;

// Hành động nhanh trên card: đánh dấu Xong / mở lại / hủy / xóa. Luôn scope theo owner_id.
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  const ownerId = String(body?.ownerId || '').trim();
  const id = String(body?.id || '').trim();
  const op = body?.op as string;
  if (!ownerId || !id) return Response.json({ error: 'missing_params' }, { status: 400 });

  const now = new Date().toISOString();

  if (op === 'delete') {
    const { error } = await supabase.from('wp_events').delete().eq('owner_id', ownerId).eq('id', id);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
    return Response.json({ ok: true, deleted: true, id });
  }

  let status: string | null = null;
  if (op === 'done') status = 'done';
  else if (op === 'active') status = 'active';   // mở lại
  else if (op === 'cancel') status = 'canceled';
  else return Response.json({ error: 'bad_op' }, { status: 400 });

  const { data, error } = await supabase
    .from('wp_events')
    .update({ status, updated_at: now })
    .eq('owner_id', ownerId).eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, event: data as WpEvent });
}

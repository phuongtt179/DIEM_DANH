import { supabase } from '@/lib/supabase';
import { summarize, todayVN, type WpEvent } from '@/lib/work';

export const maxDuration = 15;

// Tổng hợp thống kê 1 tháng (mặc định tháng hiện tại) — CỐ ĐỊNH, không qua AI. Dùng cho nút "Tổng hợp".
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  const ownerId = String(body?.ownerId || '').trim();
  if (!ownerId) return Response.json({ error: 'no_owner' }, { status: 400 });
  const month = typeof body?.month === 'string' ? body.month : undefined;

  const { data, error } = await supabase
    .from('wp_events')
    .select('*')
    .eq('owner_id', ownerId)
    .neq('status', 'canceled');
  if (error) return Response.json({ error: 'db_error', message: error.message }, { status: 500 });

  const stats = summarize((data || []) as WpEvent[], month, todayVN());
  return Response.json({ stats });
}

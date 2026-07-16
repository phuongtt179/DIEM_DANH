import { supabase } from '@/lib/supabase';
import { rangeVN, eventDateVN, sortEvents, todayVN, type WpEvent } from '@/lib/work';

export const maxDuration = 15;

// Truy vấn CỐ ĐỊNH cho 3 nút Hôm nay / Tuần này / Tháng này — KHÔNG qua AI.
// Trả về công việc trong khoảng + các việc còn dang dở đã QUÁ HẠN (luôn hiện để người bận không bỏ sót).
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  const ownerId = String(body?.ownerId || '').trim();
  const kind = body?.range;
  if (!ownerId) return Response.json({ error: 'no_owner' }, { status: 400 });
  if (!['today', 'week', 'month'].includes(kind)) return Response.json({ error: 'bad_range' }, { status: 400 });

  const { start, end, label } = rangeVN(kind);
  const today = todayVN();

  const { data, error } = await supabase
    .from('wp_events')
    .select('*')
    .eq('owner_id', ownerId)
    .neq('status', 'canceled');
  if (error) return Response.json({ error: 'db_error', message: error.message }, { status: 500 });

  const all = (data || []) as WpEvent[];
  const events = all.filter(e => {
    const wd = eventDateVN(e);
    const inRange = wd >= start && wd <= end;
    const overdueActive = e.status === 'active' && wd < today; // việc dang dở quá hạn
    return inRange || overdueActive;
  }).sort(sortEvents);

  return Response.json({ label, range: { start, end }, events });
}

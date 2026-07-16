import { supabase } from '@/lib/supabase';
import { getGeminiKeys, callGeminiRotate, isDailyLimit } from '@/lib/gemini';
import { rangeVN, eventDateVN, sortEvents, todayVN, summarize, type WpEvent, type WpStats } from '@/lib/work';

export const maxDuration = 30;
const MODEL = 'gemini-3.1-flash-lite';

// Chuẩn hóa tên để so khớp (NFC + bỏ ký tự ẩn) — giống chat lớp học.
function normName(s: string): string {
  return (s || '').normalize('NFC').replace(/\p{Cf}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ==================== TOOLS (owner-scoped) ====================

async function toolAddEvent(ownerId: string, args: any) {
  const title = String(args?.title || '').trim();
  if (!title) return { ok: false, error: 'thiếu tiêu đề công việc' };
  const type: 'event' | 'task' =
    args?.type === 'task' || args?.type === 'event'
      ? args.type
      : (args?.start_at ? 'event' : (args?.due_date ? 'task' : 'event'));
  const row = {
    owner_id: ownerId,
    title,
    type,
    start_at: args?.start_at || null,
    due_date: args?.due_date || null,
    location: args?.location || null,
    note: args?.note || null,
    status: 'active',
    source_text: args?.source_text || null,
  };
  const { data, error } = await supabase.from('wp_events').insert([row]).select('*').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, event: data as WpEvent };
}

async function fetchOwnerEvents(ownerId: string, includeCanceled = false): Promise<WpEvent[]> {
  let q = supabase.from('wp_events').select('*').eq('owner_id', ownerId);
  if (!includeCanceled) q = q.neq('status', 'canceled');
  const { data } = await q;
  return (data || []) as WpEvent[];
}

async function toolFindEvents(ownerId: string, args: any) {
  const kw = normName(String(args?.keyword || ''));
  const all = await fetchOwnerEvents(ownerId);
  const matches = (kw
    ? all.filter(e => normName(e.title).includes(kw) || normName(e.note || '').includes(kw))
    : all
  ).sort(sortEvents);
  return { found: matches.length, matches };
}

async function toolListEvents(ownerId: string, args: any) {
  const range = String(args?.range || 'pending');
  const today = todayVN();
  const all = await fetchOwnerEvents(ownerId);
  let events: WpEvent[];
  if (range === 'today' || range === 'week' || range === 'month') {
    const { start, end } = rangeVN(range);
    events = all.filter(e => {
      const wd = eventDateVN(e);
      return (wd >= start && wd <= end) || (e.status === 'active' && wd < today);
    });
  } else if (range === 'overdue') {
    events = all.filter(e => e.status === 'active' && eventDateVN(e) < today);
  } else if (range === 'all') {
    events = all;
  } else {
    // 'pending' — mọi việc chưa xong
    events = all.filter(e => e.status === 'active');
  }
  events = events.sort(sortEvents);
  return { count: events.length, events };
}

async function toolUpdateEvent(ownerId: string, args: any) {
  const id = String(args?.id || '').trim();
  const op = String(args?.op || '').trim();
  if (!id) return { ok: false, error: 'thiếu id — hãy dùng find_events trước' };
  const now = new Date().toISOString();

  if (op === 'delete') {
    const { error } = await supabase.from('wp_events').delete().eq('owner_id', ownerId).eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, deleted: true, id };
  }
  const patch: any = { updated_at: now };
  if (op === 'done') patch.status = 'done';
  else if (op === 'cancel') patch.status = 'canceled';
  else if (op === 'reschedule' || op === 'edit') {
    if (args?.new_title && String(args.new_title).trim()) patch.title = String(args.new_title).trim();
    if (args?.new_location !== undefined) patch.location = args.new_location || null;
    if (args?.new_note !== undefined) patch.note = args.new_note || null;
    if (args?.new_start_at) { patch.start_at = args.new_start_at; patch.type = 'event'; }
    if (args?.new_due_date) { patch.due_date = args.new_due_date; patch.type = 'task'; }
    if (Object.keys(patch).length <= 1) return { ok: false, error: 'không có gì để sửa' };
  } else return { ok: false, error: 'op không hợp lệ' };

  const { data, error } = await supabase.from('wp_events')
    .update(patch).eq('owner_id', ownerId).eq('id', id).select('*').maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'không tìm thấy công việc' };
  return { ok: true, event: data as WpEvent };
}

async function toolGetStats(ownerId: string, args: any) {
  const all = await fetchOwnerEvents(ownerId);
  const stats = summarize(all, typeof args?.month === 'string' ? args.month : undefined, todayVN());
  return { stats };
}

async function runTool(ownerId: string, name: string, args: any): Promise<any> {
  switch (name) {
    case 'add_event': return toolAddEvent(ownerId, args);
    case 'find_events': return toolFindEvents(ownerId, args);
    case 'list_events': return toolListEvents(ownerId, args);
    case 'update_event': return toolUpdateEvent(ownerId, args);
    case 'get_stats': return toolGetStats(ownerId, args);
    default: return { error: `unknown_tool: ${name}` };
  }
}

// ==================== KHAI BÁO CÔNG CỤ ====================

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'add_event',
      description: 'Tạo một công việc/sự kiện mới từ lời người dùng hoặc từ văn bản giấy mời / tin Zalo được dán vào. Tự bóc tách các trường.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Tên việc/sự kiện (ngắn gọn, vd "Họp sơ kết học kỳ I")' },
          type: { type: 'string', enum: ['event', 'task'], description: 'event = sự kiện có giờ (họp, dự lễ); task = việc cần làm có hạn (nộp báo cáo)' },
          start_at: { type: 'string', description: 'Thời điểm diễn ra sự kiện, dạng "YYYY-MM-DDTHH:mm:00+07:00" (giờ VN). Chỉ cho type=event.' },
          due_date: { type: 'string', description: 'Hạn của việc, dạng "YYYY-MM-DD". Chỉ cho type=task.' },
          location: { type: 'string', description: 'Địa điểm (nếu có)' },
          note: { type: 'string', description: 'Cần chuẩn bị / ghi chú (vd "mang theo báo cáo")' },
          source_text: { type: 'string', description: 'Nguyên văn bản gốc (giấy mời/Zalo) nếu người dùng dán vào, để lưu đối chiếu.' },
        },
        required: ['title'],
      },
    },
    {
      name: 'list_events',
      description: 'Liệt kê công việc theo khoảng để trả lời câu hỏi lịch. range: today/week/month (kèm việc quá hạn), overdue (chỉ quá hạn), pending (mọi việc chưa xong), all.',
      parameters: {
        type: 'object',
        properties: { range: { type: 'string', enum: ['today', 'week', 'month', 'overdue', 'pending', 'all'] } },
        required: ['range'],
      },
    },
    {
      name: 'find_events',
      description: 'Tìm công việc theo từ khóa (trong tên hoặc ghi chú), trả về kèm id. DÙNG TRƯỚC khi sửa/hủy/xóa/dời để lấy đúng id.',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: 'Từ khóa tên việc' } },
        required: ['keyword'],
      },
    },
    {
      name: 'update_event',
      description: 'Cập nhật 1 công việc theo id (lấy từ find_events). op: done (đánh dấu xong), cancel (hủy), delete (xóa hẳn), edit (sửa chi tiết — kèm bất kỳ new_title/new_location/new_note/new_start_at/new_due_date nào cần đổi). reschedule = edit chỉ đổi thời gian.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'id công việc (từ find_events)' },
          op: { type: 'string', enum: ['done', 'cancel', 'delete', 'edit', 'reschedule'] },
          new_title: { type: 'string', description: 'Tên mới (khi edit)' },
          new_location: { type: 'string', description: 'Địa điểm mới (khi edit)' },
          new_note: { type: 'string', description: 'Ghi chú/cần chuẩn bị mới (khi edit)' },
          new_start_at: { type: 'string', description: 'Thời điểm mới "YYYY-MM-DDTHH:mm:00+07:00" (sự kiện)' },
          new_due_date: { type: 'string', description: 'Hạn mới "YYYY-MM-DD" (việc)' },
        },
        required: ['id', 'op'],
      },
    },
    {
      name: 'get_stats',
      description: 'Tổng hợp/thống kê công việc theo tháng: tổng số, đã xong, còn lại, quá hạn, số sự kiện vs việc, và so với tháng trước. Dùng khi người dùng hỏi "tổng hợp", "tháng này bao nhiêu việc", "đã xong bao nhiêu", "bận hơn tháng trước không".',
      parameters: {
        type: 'object',
        properties: { month: { type: 'string', description: 'Tháng "YYYY-MM" (bỏ trống = tháng hiện tại)' } },
      },
    },
  ],
}];

function systemPrompt(): string {
  const today = todayVN();
  return `Bạn là TRỢ LÝ NHẮC VIỆC cá nhân cho một người bận (hiệu phó/hiệu trưởng). Giúp họ lưu & tra cứu công việc, lịch họp, việc cần làm.

Hôm nay là ${today} (giờ Việt Nam).

BẠN LÀM ĐƯỢC:
- THÊM VIỆC: người dùng gõ tự nhiên ("họp phụ huynh 8h thứ 6", "nhắc nộp báo cáo trước 25/7") HOẶC dán nguyên GIẤY MỜI / TIN ZALO. Bạn tự bóc tách rồi gọi add_event.
- TRA CỨU: "hôm nay/tuần này/tháng này có gì", "việc nào chưa xong", "có việc gì quá hạn", "ngày mai cần chuẩn bị gì" → gọi list_events.
- TỔNG HỢP/THỐNG KÊ: "tổng hợp tháng", "tháng này bao nhiêu việc", "đã xong bao nhiêu / còn tồn", "bận hơn tháng trước không" → gọi get_stats (ứng dụng sẽ hiện THẺ TỔNG HỢP; bạn chỉ cần trả 1 câu ngắn như "Tổng hợp tháng 7 👇").
- SỬA/HỦY/XÓA/DỜI: gọi find_events lấy id rồi update_event. Sửa chi tiết ("đổi địa điểm thành...", "đổi tên...", "thêm ghi chú mang laptop", "dời sang 15h mai") → op=edit kèm các trường new_* cần đổi. Nếu tìm ra nhiều việc trùng thì hỏi chọn.

BÓC TÁCH GIẤY MỜI (rất quan trọng):
- title = tóm tắt nội dung (thường sau "V/v" hoặc tên hội nghị).
- type = event nếu có giờ họp/dự; task nếu là việc phải nộp có hạn.
- start_at = ghép ngày + giờ trong giấy, dạng "YYYY-MM-DDTHH:mm:00+07:00". Nếu chỉ có ngày, để giờ 00:00 và vẫn là event.
- location = địa điểm; note = phần "đề nghị mang theo/chuẩn bị/thành phần".
- source_text = dán nguyên văn bản gốc.
- Nếu thiếu năm, hiểu là năm hiện tại. Suy ra ngày từ "thứ 6 tuần sau", "mai", "25/7"... dựa vào hôm nay.

QUY TẮC:
- Thêm việc thì làm NGAY (không cần hỏi xác nhận) — người dùng cần nhanh; card hiện ra để họ tự kiểm.
- Xóa/hủy: nếu find_events ra NHIỀU việc trùng khớp thì HỎI người dùng chọn đúng cái, đừng xóa nhầm.
- Sau khi thao tác, trả lời bằng tiếng Việt THẬT NGẮN (1 câu). KHÔNG liệt kê chi tiết bằng chữ — ứng dụng sẽ tự hiện các CARD công việc cho người dùng. Ví dụ: "Đã lưu 👇", "Tuần này có 3 việc 👇", "Đã đánh dấu xong 👇".
- Nếu không có việc nào, nói rõ "Không có việc nào." (ngắn gọn).
- Luôn dựa vào kết quả công cụ, không bịa.`;
}

// ==================== HANDLER ====================

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  const ownerId = String(body?.ownerId || '').trim();
  if (!ownerId) return Response.json({ error: 'no_owner' }, { status: 400 });

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0 || !String(messages[messages.length - 1]?.content || '').trim()) {
    return Response.json({ error: 'no_question' }, { status: 400 });
  }

  const keys = getGeminiKeys();
  if (!keys.length) return Response.json({ error: 'no_api_key' }, { status: 500 });

  const contents: any[] = messages.map((m: any) => ({
    role: m.role === 'ai' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));

  const sysInstruction = { parts: [{ text: systemPrompt() }] };
  const cardMap = new Map<string, WpEvent>();  // công việc để render thành card
  let statsOut: WpStats | null = null;         // thẻ tổng hợp (nếu có)

  const collect = (result: any) => {
    if (result?.event?.id) cardMap.set(result.event.id, result.event);
    for (const e of (result?.events || result?.matches || [])) {
      if (e?.id) cardMap.set(e.id, e);
    }
    if (result?.deleted && result?.id) cardMap.delete(result.id);
    if (result?.stats) statsOut = result.stats;
  };

  for (let i = 0; i < 10; i++) {
    const payload = JSON.stringify({
      systemInstruction: sysInstruction,
      contents,
      tools: TOOLS,
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    });

    let res: Response;
    try {
      res = await callGeminiRotate({ model: MODEL, keys, payload });
    } catch (e) {
      console.error('[work-chat] network error:', e);
      return Response.json({ error: 'network' }, { status: 500 });
    }

    if (res.status === 429) {
      const eb = await res.json().catch(() => ({}));
      return Response.json({ error: isDailyLimit(eb) ? 'quota_rpd' : 'quota_rpm' }, { status: 429 });
    }
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      console.error('[work-chat] gemini error', res.status, JSON.stringify(b));
      return Response.json({ error: 'gemini_error', details: b }, { status: 500 });
    }

    const data = await res.json();
    const modelContent = data.candidates?.[0]?.content;
    const parts = modelContent?.parts || [];
    const fnCalls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);

    if (fnCalls.length > 0) {
      const responseParts: any[] = [];
      for (const fc of fnCalls) {
        let result: any;
        try { result = await runTool(ownerId, fc.name, fc.args || {}); }
        catch (e) { result = { error: 'tool_failed', message: String(e) }; }
        collect(result);
        responseParts.push({ functionResponse: { name: fc.name, response: { result } } });
      }
      contents.push(modelContent);              // giữ nguyên (thought_signature cho Gemini 3.x)
      contents.push({ role: 'user', parts: responseParts });
      continue;
    }

    const answer = parts.map((p: any) => p.text).filter(Boolean).join('').trim();
    const events = [...cardMap.values()].sort(sortEvents);
    return Response.json({ answer: answer || 'Xong 👇', events, stats: statsOut });
  }

  return Response.json({ error: 'too_many_steps' }, { status: 500 });
}

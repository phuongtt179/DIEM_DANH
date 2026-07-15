import { supabase } from '@/lib/supabase';
import { getGeminiKeys, callGeminiRotate, isDailyLimit } from '@/lib/gemini';

export const maxDuration = 30;
const MODEL = 'gemini-3.1-flash-lite';

// Từ ngắn/quá phổ biến — bỏ khi lọc từ khóa
const STOP = new Set([
  'tôi', 'toi', 'em', 'con', 'là', 'la', 'và', 'va', 'của', 'cua', 'cho', 'với', 'voi',
  'hôm', 'hom', 'nào', 'nao', 'gì', 'gi', 'ghi', 'note', 'khi', 'lúc', 'luc', 'có', 'co',
  'không', 'khong', 'đã', 'da', 'các', 'cac', 'một', 'mot', 'này', 'nay', 'đó', 'do',
  'bao', 'nhiêu', 'nhieu', 'ai', 'khi', 'về', 've', 'trong', 'ngày', 'ngay', 'tháng', 'thang',
]);

function keywords(q: string): string[] {
  return Array.from(new Set(
    q.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
  )).slice(0, 8);
}

// Nhận diện khoảng thời gian trong câu hỏi → lọc nhật ký theo NGÀY GHI (created_at)
function detectDateRange(q: string): { start: string; end: string; label: string } | null {
  const s = q.toLowerCase();
  const VN = 7 * 3600 * 1000; // giờ VN = UTC+7 (không có DST)
  const day = 86400000;
  // now dịch +7h để getUTC* trả về "giờ tường" VN
  const now = new Date(Date.now() + VN);
  const iso = (t: number) => new Date(t).toISOString();
  // đầu/cuối NGÀY VN (theo mốc ref) quy về mốc UTC thật để so với created_at
  const sod = (ref: Date) => Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0) - VN;
  const eod = (ref: Date) => Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 23, 59, 59, 999) - VN;

  if (/tu[àa]n\s*(này|nay|tr[ưuữ]ớc)/.test(s)) {
    const dow = (now.getUTCDay() + 6) % 7; // Thứ 2 = 0
    const monday = new Date(now.getTime() - dow * day);
    if (/tr[ưuữ]ớc/.test(s)) {
      const prevMon = new Date(monday.getTime() - 7 * day);
      const prevSun = new Date(monday.getTime() - day);
      return { start: iso(sod(prevMon)), end: iso(eod(prevSun)), label: 'tuần trước' };
    }
    return { start: iso(sod(monday)), end: iso(eod(now)), label: 'tuần này' };
  }
  if (/th[áaá]ng\s*(này|nay|tr[ưuữ]ớc)/.test(s)) {
    if (/tr[ưuữ]ớc/.test(s)) {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      return { start: iso(sod(first)), end: iso(eod(last)), label: 'tháng trước' };
    }
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start: iso(sod(first)), end: iso(eod(now)), label: 'tháng này' };
  }
  // Tháng CỤ THỂ: "tháng 7", "tháng 6/2026", "tháng 7 năm 2026"
  const mMonth = s.match(/th[áaá]ng\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{4})|\s*năm\s*(\d{4}))?/);
  if (mMonth) {
    const mo = Math.min(12, Math.max(1, parseInt(mMonth[1])));
    const yr = parseInt(mMonth[2] || mMonth[3] || String(now.getUTCFullYear()));
    const first = new Date(Date.UTC(yr, mo - 1, 1));
    const last = new Date(Date.UTC(yr, mo, 0));
    return { start: iso(sod(first)), end: iso(eod(last)), label: `tháng ${mo}/${yr}` };
  }
  if (/hôm\s*qua|bữa\s*qua/.test(s)) {
    const y = new Date(now.getTime() - day);
    return { start: iso(sod(y)), end: iso(eod(y)), label: 'hôm qua' };
  }
  if (/hôm\s*nay|bữa\s*nay|ngày\s*nay/.test(s)) {
    return { start: iso(sod(now)), end: iso(eod(now)), label: 'hôm nay' };
  }
  const mDays = s.match(/(\d+)\s*ng[àaá]y\s*(qua|g[ầaấ]n|nay|tr[ưuữ]ớc)/);
  if (mDays) {
    const n = Math.max(1, parseInt(mDays[1]));
    return { start: iso(sod(new Date(now.getTime() - (n - 1) * day))), end: iso(eod(now)), label: `${n} ngày qua` };
  }
  if (/g[ầaấ]n\s*đây/.test(s)) {
    return { start: iso(sod(new Date(now.getTime() - 6 * day))), end: iso(eod(now)), label: '7 ngày gần đây' };
  }
  return null;
}

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  const question = String(body?.question || '').trim();
  if (!question) return Response.json({ error: 'no_question' }, { status: 400 });

  const keys = getGeminiKeys();
  if (!keys.length) return Response.json({ error: 'no_api_key' }, { status: 500 });

  // Các bộ lọc: nhãn (#tag), yêu thích, khoảng thời gian
  const tagFilters = Array.from(new Set((question.toLowerCase().match(/#([\p{L}\p{N}_]+)/gu) || []).map(t => t.slice(1))));
  const favOnly = /y[êe]u\s*th[íi]ch|mục\s*thích|favorite/i.test(question);
  const range = detectDateRange(question);

  const SEL = 'content, created_at, tags, is_favorite';
  let entries: any[] = [];
  const hasFilter = tagFilters.length > 0 || favOnly || !!range;

  if (hasFilter) {
    let q = supabase.from('journal_entries').select(SEL);
    if (tagFilters.length) q = q.overlaps('tags', tagFilters);
    if (favOnly) q = q.eq('is_favorite', true);
    if (range) q = q.gte('created_at', range.start).lte('created_at', range.end);
    const { data } = await q.order('created_at', { ascending: false }).limit(100);
    entries = data || [];
    if (entries.length === 0) {
      const what = tagFilters.length ? `nhãn ${tagFilters.map(t => '#' + t).join(', ')}` : favOnly ? 'mục yêu thích' : range!.label;
      return Response.json({ answer: `Không có mục nhật ký nào cho ${what}.` });
    }
  } else {
    // Không có bộ lọc → lọc theo từ khóa; không khớp thì lấy gần đây nhất
    const kws = keywords(question);
    if (kws.length) {
      const orExpr = kws.map(w => `content.ilike.%${w}%`).join(',');
      const { data } = await supabase.from('journal_entries').select(SEL).or(orExpr)
        .order('created_at', { ascending: false }).limit(60);
      entries = data || [];
    }
    if (entries.length === 0) {
      const { data } = await supabase.from('journal_entries').select(SEL)
        .order('created_at', { ascending: false }).limit(40);
      entries = data || [];
    }
  }

  if (entries.length === 0) {
    return Response.json({ answer: 'Chưa có mục nhật ký nào để tra cứu.' });
  }

  const fmtDate = (s: string) => {
    const d = new Date(s);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  const context = entries.map((e: any) => {
    const tag = (e.tags && e.tags.length) ? ` (nhãn: ${e.tags.join(', ')})` : '';
    const fav = e.is_favorite ? ' ⭐' : '';
    return `[${fmtDate(e.created_at)}]${fav} ${e.content}${tag}`;
  }).join('\n');

  const todayStr = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }); // dd/mm/yyyy giờ VN
  const systemPrompt = `Hôm nay là ${todayStr}.
Bạn giúp chủ nhân tra cứu NHẬT KÝ CÁ NHÂN của họ. Chỉ được dựa vào các mục nhật ký dưới đây, KHÔNG bịa thêm.
- Trả lời ngắn gọn, đúng trọng tâm câu hỏi, bằng tiếng Việt.
- Khi nhắc tới nội dung nào, ghi kèm NGÀY của mục đó (dd/mm/yyyy).
- Nếu các mục không chứa thông tin liên quan, nói thẳng "Không tìm thấy mục nhật ký nào về việc này."
- Có thể tổng hợp nhiều mục nếu liên quan.

CÁC MỤC NHẬT KÝ (mới nhất trước):
${context}`;

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: question }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  });

  let res: Response;
  try {
    res = await callGeminiRotate({ model: MODEL, keys, payload });
  } catch {
    return Response.json({ error: 'network' }, { status: 500 });
  }
  if (res.status === 429) {
    const eb = await res.json().catch(() => ({}));
    return Response.json({ error: isDailyLimit(eb) ? 'quota_rpd' : 'quota_rpm' }, { status: 429 });
  }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    return Response.json({ error: 'gemini_error', details: b }, { status: 500 });
  }

  const data = await res.json();
  const answer = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text).filter(Boolean).join('').trim();
  if (!answer) return Response.json({ error: 'empty' }, { status: 500 });
  return Response.json({ answer });
}

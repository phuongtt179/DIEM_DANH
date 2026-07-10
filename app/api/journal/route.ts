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

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }
  const question = String(body?.question || '').trim();
  if (!question) return Response.json({ error: 'no_question' }, { status: 400 });

  const keys = getGeminiKeys();
  if (!keys.length) return Response.json({ error: 'no_api_key' }, { status: 500 });

  // Lọc các mục nhật ký liên quan theo từ khóa; không có từ khóa rõ → lấy gần đây nhất
  const kws = keywords(question);
  let entries: any[] = [];
  if (kws.length) {
    const orExpr = kws.map(w => `content.ilike.%${w}%`).join(',');
    const { data } = await supabase
      .from('journal_entries')
      .select('content, created_at')
      .or(orExpr)
      .order('created_at', { ascending: false })
      .limit(60);
    entries = data || [];
  }
  if (entries.length === 0) {
    const { data } = await supabase
      .from('journal_entries')
      .select('content, created_at')
      .order('created_at', { ascending: false })
      .limit(40);
    entries = data || [];
  }

  if (entries.length === 0) {
    return Response.json({ answer: 'Chưa có mục nhật ký nào để tra cứu.' });
  }

  const fmtDate = (s: string) => {
    const d = new Date(s);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  const context = entries.map((e: any) => `[${fmtDate(e.created_at)}] ${e.content}`).join('\n');

  const systemPrompt = `Bạn giúp chủ nhân tra cứu NHẬT KÝ CÁ NHÂN của họ. Chỉ được dựa vào các mục nhật ký dưới đây, KHÔNG bịa thêm.
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

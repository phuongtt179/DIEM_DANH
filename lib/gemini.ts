// Tiện ích gọi Gemini + xoay vòng nhiều API key để né giới hạn ngày (RPD).
// Port từ dự án ONTAP TIN (api/_gemini.js) sang TypeScript.

// Lấy tất cả key đã cấu hình: GEMINI_API_KEY, GEMINI_API_KEY_2 ... GEMINI_API_KEY_6
export function getGeminiKeys(): string[] {
  const keys: string[] = [];
  const push = (v?: string) => { if (v && v.trim()) keys.push(v.trim()); };
  push(process.env.GEMINI_API_KEY);
  // Đọc cả GEMINI_API_KEY_1 .. _6 (linh hoạt cách đặt tên)
  for (let i = 1; i <= 6; i++) push(process.env[`GEMINI_API_KEY_${i}`]);
  return keys;
}

// Nhận diện lỗi 429 do hết hạn mức NGÀY (RPD) — để phân biệt với giới hạn/phút (RPM)
export const isDailyLimit = (obj: unknown): boolean =>
  /daily|per[_ ]?day|perday|rpd|quota.*day/i.test(JSON.stringify(obj || {}));

// 503 = model quá tải ("high demand" / overloaded) — lỗi tạm thời của Google, nên thử lại được.
const isRetryableStatus = (status: number) => status === 429 || status === 503;

// Gọi Gemini generateContent, tự xoay vòng key khi gặp 429, và tự thử lại khi Gemini báo quá tải (503).
// Trả về đối tượng Response (chưa đọc body) để caller tự xử lý.
export async function callGeminiRotate(
  { model, keys, payload }: { model: string; keys: string[]; payload: string }
): Promise<Response> {
  const attempt = (key: string) => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }
  );

  // Xáo trộn thứ tự key → mỗi lần gọi random chọn 1 key; key nào hết lượt/quá tải mới nhảy sang key khác
  const order = [...keys].sort(() => Math.random() - 0.5);

  let last: Response | null = null;
  for (const key of order) {
    const res = await attempt(key);
    if (!isRetryableStatus(res.status)) return res;   // thành công, hoặc lỗi khác 429/503 → trả luôn
    last = res;                                        // key này hết lượt hoặc model đang quá tải → thử key kế tiếp
  }
  if (!last || !order.length) return last as Response;

  // Tất cả key đều lỗi: nếu là 429 do giới hạn NGÀY thì không cứu được, trả lỗi luôn.
  if (last.status === 429) {
    const eb = await last.clone().json().catch(() => ({}));
    if (isDailyLimit(eb)) return last;
  }

  // 429 theo PHÚT hoặc 503 (model quá tải) → chờ rồi thử lại vài lần, tăng dần thời gian chờ
  for (const ms of [3000, 6000]) {
    await new Promise(r => setTimeout(r, ms));
    const res = await attempt(order[0]);
    if (!isRetryableStatus(res.status)) return res;
    last = res;
  }
  return last;
}

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

// Gọi Gemini generateContent, tự xoay vòng key khi gặp 429.
// Trả về đối tượng Response (chưa đọc body) để caller tự xử lý.
export async function callGeminiRotate(
  { model, keys, payload }: { model: string; keys: string[]; payload: string }
): Promise<Response> {
  const attempt = (key: string) => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }
  );

  // Xáo trộn thứ tự key → mỗi lần gọi random chọn 1 key; key nào hết lượt mới nhảy sang key khác
  const order = [...keys].sort(() => Math.random() - 0.5);

  let last: Response | null = null;
  for (const key of order) {
    const res = await attempt(key);
    if (res.status !== 429) return res;   // thành công, hoặc lỗi khác 429 → trả luôn
    last = res;                            // key này hết lượt → thử key kế tiếp
  }

  // Tất cả key đều 429: nếu là giới hạn theo PHÚT (không phải theo ngày) thì chờ rồi thử lại 1 lần
  if (last && order.length) {
    const eb = await last.clone().json().catch(() => ({}));
    if (!isDailyLimit(eb)) {
      await new Promise(r => setTimeout(r, 5000));
      return attempt(order[0]);
    }
  }
  return last as Response;
}

// Trợ lý nhắc việc (GĐ1) — kiểu dữ liệu + tiện ích dùng chung cho client và API.
// GIỮ THUẦN (không import supabase/next) để cả frontend lẫn route đều dùng được.

export type WpEventType = 'event' | 'task';           // sự kiện (có giờ) | việc (có hạn)
export type WpEventStatus = 'active' | 'done' | 'canceled';

export interface WpEvent {
  id: string;
  owner_id: string;
  title: string;
  type: WpEventType;
  start_at: string | null;   // ISO — sự kiện
  due_date: string | null;   // 'YYYY-MM-DD' — việc
  location: string | null;
  note: string | null;
  status: WpEventStatus;
  source_text: string | null;
  created_at: string;
  updated_at: string;
}

const VN = 7 * 3600 * 1000;   // giờ VN = UTC+7 (không DST)
const DAY = 86400000;

// Ngày hôm nay theo giờ VN, dạng 'YYYY-MM-DD'
export function todayVN(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function pad(n: number): string { return String(n).padStart(2, '0'); }
function ymd(y: number, m0: number, d: number): string { return `${y}-${pad(m0 + 1)}-${pad(d)}`; }

// Các mốc ngày theo giờ VN (getUTC* trên mốc đã +7h)
function vnParts() {
  const n = new Date(Date.now() + VN);
  return { y: n.getUTCFullYear(), m: n.getUTCMonth(), d: n.getUTCDate(), dow: n.getUTCDay() };
}

// Khoảng thời gian cho 3 nút tra nhanh, trả về [start, end] dạng 'YYYY-MM-DD' (bao gồm 2 đầu)
export function rangeVN(kind: 'today' | 'week' | 'month'): { start: string; end: string; label: string } {
  const { y, m, d, dow } = vnParts();
  if (kind === 'today') return { start: ymd(y, m, d), end: ymd(y, m, d), label: 'Hôm nay' };
  if (kind === 'week') {
    const monOff = (dow + 6) % 7; // Thứ 2 = 0
    const base = new Date(Date.UTC(y, m, d));
    const mon = new Date(base.getTime() - monOff * DAY);
    const sun = new Date(mon.getTime() + 6 * DAY);
    return {
      start: ymd(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate()),
      end: ymd(sun.getUTCFullYear(), sun.getUTCMonth(), sun.getUTCDate()),
      label: 'Tuần này',
    };
  }
  const last = new Date(Date.UTC(y, m + 1, 0));
  return {
    start: ymd(y, m, 1),
    end: ymd(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()),
    label: 'Tháng này',
  };
}

// Ngày "mốc" của 1 công việc (để xếp lịch & lọc theo khoảng), dạng 'YYYY-MM-DD' giờ VN
export function eventDateVN(e: Pick<WpEvent, 'type' | 'start_at' | 'due_date' | 'created_at'>): string {
  if (e.type === 'task' && e.due_date) return e.due_date;
  if (e.start_at) return new Date(e.start_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (e.due_date) return e.due_date;
  return new Date(e.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

export type WpState = 'done' | 'canceled' | 'overdue' | 'today' | 'upcoming';

// Trạng thái hiển thị (badge) — quá hạn được SUY RA, không lưu trong DB
export function deriveState(e: WpEvent, today = todayVN()): WpState {
  if (e.status === 'done') return 'done';
  if (e.status === 'canceled') return 'canceled';
  const wd = eventDateVN(e);
  if (wd < today) return 'overdue';
  if (wd === today) return 'today';
  return 'upcoming';
}

// So sánh để xếp: quá hạn/sớm hơn lên trước; cùng ngày thì theo giờ start_at
export function sortEvents(a: WpEvent, b: WpEvent): number {
  const da = eventDateVN(a), db = eventDateVN(b);
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.start_at ? new Date(a.start_at).getTime() : 0;
  const tb = b.start_at ? new Date(b.start_at).getTime() : 0;
  return ta - tb;
}

// ---- GĐ2: thống kê tháng ----

// Tháng hiện tại theo giờ VN, dạng 'YYYY-MM'
export function currentMonthVN(): string { return todayVN().slice(0, 7); }

// Khoảng ngày của 1 tháng 'YYYY-MM' → [start,end] + tháng liền trước
export function monthMeta(ym?: string): { ym: string; start: string; end: string; label: string; prev: string } {
  const m = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : currentMonthVN();
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const prev = mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`;
  return { ym: m, start: `${m}-01`, end: `${m}-${pad(last)}`, label: `Tháng ${mo}/${y}`, prev };
}

export interface WpStats {
  month: string; label: string;
  total: number; done: number; active: number; overdue: number;
  events: number; tasks: number;
  prevTotal: number; trend: 'more' | 'less' | 'same';
}

function countInMonth(all: WpEvent[], start: string, end: string): WpEvent[] {
  return all.filter(e => { const wd = eventDateVN(e); return wd >= start && wd <= end; });
}

// Tổng hợp cho 1 tháng, dựa trên danh sách công việc CHƯA HỦY của người dùng.
export function summarize(all: WpEvent[], ym?: string, today = todayVN()): WpStats {
  const { ym: m, start, end, label, prev } = monthMeta(ym);
  const inMonth = countInMonth(all, start, end);
  const p = monthMeta(prev);
  const prevTotal = countInMonth(all, p.start, p.end).length;
  const total = inMonth.length;
  const trend: 'more' | 'less' | 'same' = total > prevTotal ? 'more' : total < prevTotal ? 'less' : 'same';
  return {
    month: m, label,
    total,
    done: inMonth.filter(e => e.status === 'done').length,
    active: inMonth.filter(e => e.status === 'active').length,
    overdue: inMonth.filter(e => e.status === 'active' && eventDateVN(e) < today).length,
    events: inMonth.filter(e => e.type === 'event').length,
    tasks: inMonth.filter(e => e.type === 'task').length,
    prevTotal, trend,
  };
}

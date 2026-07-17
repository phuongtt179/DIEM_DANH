'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Loader2, Send, Check, Trash2, RotateCcw, CalendarDays, CalendarRange, Calendar, BarChart3, Pencil } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { deriveState, type WpEvent, type WpState, type WpStats } from '@/lib/work';

// src:'quick' = kết quả từ 3 nút/Tổng hợp (chỉ giữ MỘT lần, bấm lại thì thay thế)
type Block =
  | { kind: 'user'; text: string; src?: 'quick' }
  | { kind: 'ai'; text: string; src?: 'quick' }
  | { kind: 'label'; text: string; src?: 'quick' }
  | { kind: 'empty'; text: string; src?: 'quick' }
  | { kind: 'cards'; events: WpEvent[]; src?: 'quick' }
  | { kind: 'stats'; stats: WpStats; src?: 'quick' };

const QUICK = [
  { range: 'today' as const, label: '📅 Hôm nay', icon: CalendarDays },
  { range: 'week' as const, label: '🗓️ Tuần này', icon: CalendarRange },
  { range: 'month' as const, label: '📆 Tháng này', icon: Calendar },
];

const SUGGESTIONS = [
  'Dán giấy mời / tin Zalo vào đây để lưu thành việc',
  'Họp phụ huynh 8h thứ 6 tuần sau',
  'Nhắc tôi nộp báo cáo trước 25/7',
  'Việc nào đang quá hạn?',
];

// ---- Hiển thị ----
const BADGE: Record<WpState, { text: string; cls: string; dot: string }> = {
  overdue: { text: 'Quá hạn', cls: 'text-red-600 bg-red-50 border-red-200', dot: '🔴' },
  today: { text: 'Hôm nay', cls: 'text-amber-600 bg-amber-50 border-amber-200', dot: '🟠' },
  upcoming: { text: 'Sắp tới', cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', dot: '🟢' },
  done: { text: 'Đã xong', cls: 'text-gray-500 bg-gray-100 border-gray-200', dot: '✔️' },
  canceled: { text: 'Đã hủy', cls: 'text-gray-400 bg-gray-100 border-gray-200', dot: '⚪' },
};

function fmtD(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}
function fmtT(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
}
function whenText(e: WpEvent): string {
  if (e.type === 'task') return e.due_date ? `Hạn: ${fmtD(e.due_date + 'T00:00:00+07:00')}` : 'Chưa đặt hạn';
  if (!e.start_at) return 'Chưa đặt giờ';
  const t = fmtT(e.start_at);
  return t === '00:00' ? fmtD(e.start_at) : `${fmtD(e.start_at)} · ${t}`;
}
// ISO → 'YYYY-MM-DDTHH:mm' theo giờ VN (đổ vào input datetime-local)
function toDatetimeLocal(iso: string): string {
  const s = new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); // 'YYYY-MM-DD HH:mm:ss'
  return s.slice(0, 16).replace(' ', 'T');
}
function formFromEvent(e: WpEvent) {
  return {
    title: e.title,
    type: e.type,
    dt: e.start_at ? toDatetimeLocal(e.start_at) : '',
    due: e.due_date || '',
    location: e.location || '',
    note: e.note || '',
  };
}

function Tile({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-xl px-2 py-2.5 text-center ${cls}`}>
      <div className="text-2xl font-black leading-none">{value}</div>
      <div className="text-[11px] font-semibold opacity-80 mt-1">{label}</div>
    </div>
  );
}

function StatsCard({ s }: { s: WpStats }) {
  const trend = s.trend === 'more'
    ? { t: 'bận hơn ▲', c: 'text-red-600' }
    : s.trend === 'less'
      ? { t: 'ít hơn ▼', c: 'text-emerald-600' }
      : { t: 'tương đương', c: 'text-gray-500' };
  return (
    <div className="rounded-2xl border bg-white shadow-sm p-4 max-w-md">
      <div className="flex items-center gap-2 font-black text-gray-800 mb-3">
        <BarChart3 size={18} className="text-sky-600" /> Tổng hợp {s.label}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Tổng việc" value={s.total} cls="bg-sky-50 text-sky-700" />
        <Tile label="Đã xong" value={s.done} cls="bg-emerald-50 text-emerald-700" />
        <Tile label="Còn lại" value={s.active} cls="bg-amber-50 text-amber-700" />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-2">
        <Tile label="Quá hạn" value={s.overdue} cls="bg-red-50 text-red-700" />
        <Tile label="Sự kiện" value={s.events} cls="bg-gray-100 text-gray-700" />
        <Tile label="Việc" value={s.tasks} cls="bg-gray-100 text-gray-700" />
      </div>
      <div className="mt-3 text-sm text-gray-600">
        So tháng trước ({s.prevTotal} việc): <b className={trend.c}>{trend.t}</b>
      </div>
    </div>
  );
}

function EventCard({ e, onMutate, onEdit }: {
  e: WpEvent;
  onMutate: (id: string, op: string) => void;
  onEdit: (id: string, patch: any) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState(() => formFromEvent(e));
  const st = deriveState(e);
  const b = BADGE[st];
  const done = e.status === 'done';
  const inp = 'w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 bg-gray-50';

  async function save() {
    if (!f.title.trim()) return;
    setSaving(true);
    const patch: any = { title: f.title.trim(), location: f.location.trim() || null, note: f.note.trim() || null, type: f.type };
    if (f.type === 'event') { patch.start_at = f.dt ? f.dt + ':00+07:00' : null; patch.due_date = null; }
    else { patch.due_date = f.due || null; patch.start_at = null; }
    await onEdit(e.id, patch);
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-2xl border-2 border-sky-300 bg-white shadow-sm px-3.5 py-3 space-y-2">
        <div className="text-xs font-bold text-sky-600">✏️ Sửa công việc</div>
        <input className={inp} value={f.title} onChange={ev => setF({ ...f, title: ev.target.value })} placeholder="Tên việc/sự kiện" />
        <div className="flex gap-2 items-center">
          <select className={inp + ' flex-1'} value={f.type} onChange={ev => setF({ ...f, type: ev.target.value as 'event' | 'task' })}>
            <option value="event">Sự kiện (có giờ)</option>
            <option value="task">Việc (có hạn)</option>
          </select>
          {f.type === 'event'
            ? <input type="datetime-local" className={inp + ' flex-1'} value={f.dt} onChange={ev => setF({ ...f, dt: ev.target.value })} />
            : <input type="date" className={inp + ' flex-1'} value={f.due} onChange={ev => setF({ ...f, due: ev.target.value })} />}
        </div>
        <input className={inp} value={f.location} onChange={ev => setF({ ...f, location: ev.target.value })} placeholder="Địa điểm (nếu có)" />
        <textarea className={inp + ' resize-none'} rows={2} value={f.note} onChange={ev => setF({ ...f, note: ev.target.value })} placeholder="Cần chuẩn bị / ghi chú" />
        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={saving || !f.title.trim()}
            className="flex items-center gap-1 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 px-3 py-1.5 rounded-lg disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />} Lưu
          </button>
          <button onClick={() => setEditing(false)}
            className="text-xs font-semibold text-gray-600 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100">Hủy</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border bg-white shadow-sm px-3.5 py-3 ${done ? 'opacity-70' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${b.cls}`}>{b.dot} {b.text}</span>
        <span className="text-[11px] text-gray-400 font-medium">{e.type === 'event' ? 'Sự kiện' : 'Việc cần làm'}</span>
      </div>
      <div className={`font-bold text-gray-800 leading-snug ${done ? 'line-through' : ''}`}>{e.title}</div>
      <div className="mt-1 text-sm text-gray-600 flex items-center gap-1.5">🕗 {whenText(e)}</div>
      {e.location && <div className="text-sm text-gray-600 flex items-center gap-1.5">📍 {e.location}</div>}
      {e.note && <div className="text-sm text-gray-600 flex items-start gap-1.5">📎 <span>{e.note}</span></div>}
      <div className="flex gap-1 mt-2.5 pt-2 border-t border-gray-100">
        {done ? (
          <button onClick={() => onMutate(e.id, 'active')}
            className="flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-800 px-2.5 py-1 rounded-lg hover:bg-gray-100">
            <RotateCcw size={13} /> Mở lại
          </button>
        ) : (
          <button onClick={() => onMutate(e.id, 'done')}
            className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 px-2.5 py-1 rounded-lg hover:bg-emerald-50">
            <Check size={14} /> Xong
          </button>
        )}
        <button onClick={() => { setF(formFromEvent(e)); setEditing(true); }}
          className="flex items-center gap-1 text-xs font-semibold text-sky-600 hover:text-sky-700 px-2.5 py-1 rounded-lg hover:bg-sky-50">
          <Pencil size={13} /> Sửa
        </button>
        <button onClick={() => onMutate(e.id, 'delete')}
          className="flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-600 px-2.5 py-1 rounded-lg hover:bg-red-50">
          <Trash2 size={13} /> Xóa
        </button>
      </div>
    </div>
  );
}

export default function WorkPage() {
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const didInit = useRef(false);

  // Chỉ ai có quyền use_work mới vào
  useEffect(() => {
    if (user && !hasPermission('use_work')) router.push('/');
  }, [user, hasPermission, router]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [blocks, loading]);

  // Mở app → tự hiện lịch hôm nay
  useEffect(() => {
    if (user && !didInit.current) { didInit.current = true; quickView('today'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  function showError(res: Response, data: any) {
    if (res.status === 429) {
      setErrMsg(data.error === 'quota_rpd' ? 'Đã hết lượt hỏi AI hôm nay, mai thử lại nhé.' : 'Nhiều yêu cầu cùng lúc, chờ chút rồi thử lại.');
    } else if (data.error === 'no_api_key') {
      setErrMsg('Chưa cấu hình GEMINI_API_KEY.');
    } else {
      const detail = data.details?.error?.message || data.message || '';
      setErrMsg(`Lỗi: ${data.error || res.status}${detail ? ' — ' + detail : ''}`);
    }
  }

  // Xóa các block "quick" cũ rồi thêm block mới → bấm nhiều lần không bị chồng
  function replaceQuick(...fresh: Block[]) {
    setBlocks(b => [...b.filter(x => x.src !== 'quick'), ...fresh]);
  }

  async function quickView(range: 'today' | 'week' | 'month') {
    if (loading || !user) return;
    setErrMsg('');
    const label = QUICK.find(q => q.range === range)!.label;
    setLoading(true);
    try {
      const res = await fetch('/api/work/list', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, range }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showError(res, data); return; }
      const events: WpEvent[] = data.events || [];
      replaceQuick(
        { kind: 'label', text: label, src: 'quick' },
        events.length ? { kind: 'cards', events, src: 'quick' } : { kind: 'empty', text: 'Không có việc nào chưa làm.', src: 'quick' },
      );
    } catch { setErrMsg('Có lỗi mạng, thử lại nhé.'); }
    finally { setLoading(false); }
  }

  async function quickStats() {
    if (loading || !user) return;
    setErrMsg('');
    setLoading(true);
    try {
      const res = await fetch('/api/work/stats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showError(res, data); return; }
      if (data.stats) replaceQuick({ kind: 'label', text: '📊 Tổng hợp tháng này', src: 'quick' }, { kind: 'stats', stats: data.stats, src: 'quick' });
    } catch { setErrMsg('Có lỗi mạng, thử lại nhé.'); }
    finally { setLoading(false); }
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || loading || !user) return;
    setErrMsg('');
    const newBlocks: Block[] = [...blocks, { kind: 'user', text: q }];
    setBlocks(newBlocks);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);
    // Lịch sử hội thoại (chỉ user/ai)
    const msgs = newBlocks
      .filter(b => b.kind === 'user' || b.kind === 'ai')
      .map(b => ({ role: b.kind, content: (b as any).text }));
    try {
      const res = await fetch('/api/work/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, messages: msgs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.answer) { showError(res, data); return; }
      const add: Block[] = [{ kind: 'ai', text: data.answer }];
      if (data.stats) add.push({ kind: 'stats', stats: data.stats });
      if (Array.isArray(data.events) && data.events.length) add.push({ kind: 'cards', events: data.events });
      setBlocks(b => [...b, ...add]);
    } catch { setErrMsg('Có lỗi mạng, thử lại nhé.'); }
    finally { setLoading(false); }
  }

  async function mutate(id: string, op: string) {
    if (!user) return;
    try {
      const res = await fetch('/api/work/mutate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, id, op }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setErrMsg('Không cập nhật được, thử lại.'); return; }
      // Xong / Hủy / Xóa → bỏ khỏi danh sách (chỉ hiện việc chưa làm). Mở lại / sửa → cập nhật tại chỗ.
      const remove = op === 'delete' || op === 'done' || op === 'cancel';
      setBlocks(bs => bs.map(b => b.kind === 'cards'
        ? { ...b, events: remove
            ? b.events.filter(e => e.id !== id)
            : b.events.map(e => (e.id === id && data.event ? data.event : e)) }
        : b));
    } catch { setErrMsg('Có lỗi mạng, thử lại nhé.'); }
  }

  async function editEvent(id: string, patch: any) {
    if (!user) return;
    try {
      const res = await fetch('/api/work/mutate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, id, op: 'edit', ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setErrMsg('Không sửa được, thử lại.'); return; }
      setBlocks(bs => bs.map(b => b.kind === 'cards'
        ? { ...b, events: b.events.map(e => (e.id === id && data.event ? data.event : e)) }
        : b));
    } catch { setErrMsg('Có lỗi mạng, thử lại nhé.'); }
  }

  const isEmpty = blocks.length === 0;

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 px-5 py-3.5 text-white shrink-0 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
          <CalendarClock size={20} />
        </div>
        <div>
          <h1 className="font-black text-lg leading-tight">Trợ lý nhắc việc</h1>
          <p className="text-white/80 text-xs">Dán giấy mời/Zalo hoặc gõ tự nhiên — AI tự lên lịch</p>
        </div>
      </div>

      {/* Nút tra nhanh — hàng ngang trên mobile */}
      <div className="lg:hidden shrink-0 flex gap-2 px-3 py-2 bg-white border-b border-gray-200 overflow-x-auto">
        {QUICK.map(q => (
          <button key={q.range} onClick={() => quickView(q.range)} disabled={loading}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-sm font-semibold hover:bg-sky-100 disabled:opacity-50">
            <q.icon size={15} /> {q.label.replace(/^\S+\s/, '')}
          </button>
        ))}
        <button onClick={quickStats} disabled={loading}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-sm font-semibold hover:bg-indigo-100 disabled:opacity-50">
          <BarChart3 size={15} /> Tổng hợp
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Nút tra nhanh — cột trái trên desktop */}
        <aside className="hidden lg:flex flex-col gap-2 w-52 shrink-0 border-r border-gray-200 bg-white p-3">
          <p className="text-xs font-bold text-gray-400 uppercase px-1 mb-1">Tra nhanh</p>
          {QUICK.map(q => (
            <button key={q.range} onClick={() => quickView(q.range)} disabled={loading}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-sky-50 border border-sky-100 text-sky-700 font-semibold hover:bg-sky-100 hover:border-sky-200 transition disabled:opacity-50 text-left">
              <q.icon size={18} /> <span>{q.label.replace(/^\S+\s/, '')}</span>
            </button>
          ))}
          <button onClick={quickStats} disabled={loading}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 font-semibold hover:bg-indigo-100 hover:border-indigo-200 transition disabled:opacity-50 text-left mt-1">
            <BarChart3 size={18} /> <span>Tổng hợp tháng</span>
          </button>
        </aside>

        {/* Cột chat + card */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-3 lg:px-5 py-4 space-y-3">
            {isEmpty && !loading && (
              <div className="max-w-md mx-auto text-center text-gray-400 pt-4">
                <div className="text-5xl mb-3">🗓️</div>
                <p className="text-sm mb-4">Bấm <b>Hôm nay / Tuần này / Tháng này</b> để xem lịch, hoặc thử:</p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="px-4 py-2.5 rounded-2xl bg-white border border-sky-100 text-gray-700 text-sm hover:bg-sky-50 hover:border-sky-200 transition text-left">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {blocks.map((b, i) => {
              if (b.kind === 'label') return (
                <div key={i} className="flex justify-center"><span className="text-xs font-bold text-gray-500 bg-gray-200/70 px-3 py-1 rounded-full">{b.text}</span></div>
              );
              if (b.kind === 'empty') return (
                <div key={i} className="text-center text-sm text-gray-400 py-2">{b.text}</div>
              );
              if (b.kind === 'user') return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-md">{b.text}</div>
                </div>
              );
              if (b.kind === 'ai') return (
                <div key={i} className="flex justify-start">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center text-white shrink-0 mr-2 mt-auto mb-1"><CalendarClock size={14} /></div>
                  <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed whitespace-pre-wrap bg-white text-gray-800 border border-sky-100 shadow-sm">{b.text}</div>
                </div>
              );
              if (b.kind === 'stats') return <div key={i}><StatsCard s={b.stats} /></div>;
              // cards
              return (
                <div key={i} className="grid gap-2.5 sm:grid-cols-2">
                  {b.events.map(e => <EventCard key={e.id} e={e} onMutate={mutate} onEdit={editEvent} />)}
                </div>
              );
            })}

            {loading && (
              <div className="flex justify-start">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center text-white shrink-0 mr-2"><CalendarClock size={14} /></div>
                <div className="bg-white border border-sky-100 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm"><Loader2 size={16} className="animate-spin text-sky-400" /></div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {errMsg && (
            <div className="mx-4 mb-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-center text-xs text-red-600 font-semibold shrink-0">{errMsg}</div>
          )}

          {/* Ô nhập */}
          <div className="border-t border-gray-200 bg-white px-3 py-3 flex gap-2 items-end shrink-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); autoGrow(e.target); }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={loading}
              rows={1}
              placeholder="Dán giấy mời / tin Zalo, hoặc gõ: họp 8h thứ 6…"
              className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 bg-gray-50 resize-none overflow-y-auto leading-snug"
              style={{ maxHeight: 140 }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-blue-500 flex items-center justify-center text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:scale-100 shadow-md shrink-0"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

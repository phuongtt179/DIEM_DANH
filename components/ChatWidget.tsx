'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, Loader2, Send, X, Bot } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

type Msg = { role: 'user' | 'ai'; content: string };

const SUGGESTIONS = [
  'Ai đang nợ học phí?',
  'Doanh thu từng lớp tháng này',
  'Em ... lớp ... đóng học phí tháng này',
  'Lớp ... hôm nay em ... vắng',
];

export default function ChatWidget() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [awaiting, setAwaiting] = useState(false); // AI đang chờ xác nhận → hiện nút OK/Hủy
  const pendingRef = useRef<any[]>([]); // hành động ghi đang chờ xác nhận
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, loading, open]);

  // Chỉ Admin mới thấy trợ lý; ẩn ở trang Nhật ký và Trợ lý AI (đã có khung chat riêng, tránh nhầm)
  if (!user || user.role !== 'admin') return null;
  if (pathname === '/journal' || pathname === '/chat' || pathname === '/work') return null;

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setErrMsg('');
    const newChat: Msg[] = [...chat, { role: 'user', content: q }];
    setChat(newChat);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newChat, pendingActions: pendingRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.answer) {
        if (res.status === 429) {
          setErrMsg(data.error === 'quota_rpd'
            ? 'Đã hết lượt hỏi hôm nay, mai thử lại nhé.'
            : 'Nhiều yêu cầu cùng lúc, chờ chút rồi hỏi lại.');
        } else if (data.error === 'no_api_key') {
          setErrMsg('Chưa cấu hình GEMINI_API_KEY.');
        } else {
          const detail = data.details?.error?.message || data.details?.message || '';
          setErrMsg(`Lỗi: ${data.error || res.status}${detail ? ' — ' + detail : ''}`);
        }
        return;
      }
      pendingRef.current = Array.isArray(data.pendingActions) ? data.pendingActions : [];
      setAwaiting(!!data.awaitingConfirm);
      setChat([...newChat, { role: 'ai', content: data.answer }]);
    } catch {
      setErrMsg('Có lỗi mạng, thử lại nhé.');
    } finally {
      setLoading(false);
    }
  }

  // Bấm Hủy: bỏ hành động đang chờ, không ghi gì
  function cancelPending() {
    pendingRef.current = [];
    setAwaiting(false);
    setChat(c => [...c, { role: 'ai', content: 'Đã hủy. Bạn cần gì nữa không?' }]);
  }

  return (
    <>
      {/* Nút robot nổi — góc phải dưới */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Mở trợ lý AI"
          className="hidden lg:flex fixed z-50 bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-xl items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        >
          <Bot size={26} />
        </button>
      )}

      {/* Khung chat: PC = cửa sổ góc phải, ĐT = toàn màn hình */}
      {open && (
        <div className="fixed z-50 inset-0 lg:inset-auto lg:bottom-6 lg:right-6 lg:w-[400px] lg:h-[620px] lg:max-h-[85vh] bg-white lg:rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-4 py-3 text-white shrink-0 flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-black text-base leading-tight">Trợ lý lớp học</h2>
              <p className="text-white/80 text-xs truncate">Tra cứu, thu phí & điểm danh bằng lệnh</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Đóng"
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          {/* Hội thoại */}
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-gray-50/50">
            {chat.length === 0 && !loading && (
              <div className="text-center text-gray-400 pt-4">
                <div className="text-4xl mb-2">🤖</div>
                <p className="text-sm mb-3">Bạn muốn tra cứu hay thao tác gì?</p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="px-3 py-2 rounded-xl bg-white border border-indigo-100 text-gray-700 text-sm hover:bg-indigo-50 hover:border-indigo-200 transition text-left"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chat.map((m, i) => {
              const isAi = m.role === 'ai';
              return (
                <div key={i} className={`flex ${isAi ? 'justify-start' : 'justify-end'}`}>
                  {isAi && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white shrink-0 mr-2 mt-auto mb-1">
                      <Sparkles size={14} />
                    </div>
                  )}
                  <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                    ${isAi
                      ? 'bg-white text-gray-800 border border-indigo-100 rounded-bl-md shadow-sm'
                      : 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white rounded-br-md shadow-md'}`}>
                    {m.content}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex justify-start">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white shrink-0 mr-2">
                  <Sparkles size={14} />
                </div>
                <div className="bg-white border border-indigo-100 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <Loader2 size={16} className="animate-spin text-indigo-400" />
                </div>
              </div>
            )}

            {awaiting && !loading && (
              <div className="flex gap-2 pl-10">
                <button onClick={() => send('ok')}
                  className="px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 shadow active:scale-95 transition">
                  ✓ OK, xác nhận
                </button>
                <button onClick={cancelPending}
                  className="px-3 py-1.5 rounded-xl bg-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-300 active:scale-95 transition">
                  ✕ Hủy
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {errMsg && (
            <div className="mx-3 mb-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-center text-xs text-red-600 font-semibold shrink-0">
              {errMsg}
            </div>
          )}

          {/* Ô nhập */}
          <div className="border-t border-gray-200 bg-white px-3 py-2.5 flex gap-2 items-end shrink-0">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); autoGrow(e.target); }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={loading}
              rows={1}
              placeholder="Nhập câu hỏi hoặc lệnh…"
              className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 resize-none overflow-y-auto leading-snug"
              style={{ maxHeight: 120 }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:scale-100 shadow-md shrink-0"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

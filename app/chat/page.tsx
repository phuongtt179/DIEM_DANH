'use client';

import { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

type Msg = { role: 'user' | 'ai'; content: string };

const SUGGESTIONS = [
  'Ai đang nợ học phí?',
  'Doanh thu tháng này bao nhiêu?',
  'Danh sách nộp phí lớp Cầu Lông tháng này',
  'Lớp D1 có mấy học sinh?',
];

export default function ChatPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Chỉ admin dùng khung chat (trang ẩn)
  useEffect(() => {
    if (user && user.role !== 'admin') router.push('/');
  }, [user, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, loading]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
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
        body: JSON.stringify({ messages: newChat }),
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
          // Hiện lỗi thật để chẩn đoán
          const detail = data.details?.error?.message || data.details?.message || '';
          setErrMsg(`Lỗi: ${data.error || res.status}${detail ? ' — ' + detail : ''}`);
          console.error('Chat error:', data);
        }
        return;
      }
      setChat([...newChat, { role: 'ai', content: data.answer }]);
    } catch {
      setErrMsg('Có lỗi mạng, thử lại nhé.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] lg:h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-5 py-4 text-white shrink-0 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
          <Sparkles size={20} />
        </div>
        <div>
          <h1 className="font-black text-lg leading-tight">Trợ lý tra cứu</h1>
          <p className="text-white/80 text-xs">Hỏi về nợ học phí, doanh thu, sĩ số, điểm danh… (đang thử nghiệm)</p>
        </div>
      </div>

      {/* Hội thoại */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {chat.length === 0 && !loading && (
          <div className="max-w-md mx-auto text-center text-gray-400 pt-6">
            <div className="text-5xl mb-3">🤖</div>
            <p className="text-sm mb-4">Bạn muốn tra cứu gì? Thử một trong các câu dưới đây:</p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-4 py-2.5 rounded-2xl bg-white border border-indigo-100 text-gray-700 text-sm hover:bg-indigo-50 hover:border-indigo-200 transition text-left"
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
              <div className={`max-w-[80%] lg:max-w-[65%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
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
        <div ref={bottomRef} />
      </div>

      {errMsg && (
        <div className="mx-4 mb-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-center text-xs text-red-600 font-semibold shrink-0">
          {errMsg}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-3 py-3 flex gap-2 items-end shrink-0">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); autoGrow(e.target); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={loading}
          rows={1}
          placeholder="Nhập câu hỏi tra cứu…"
          className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 resize-none overflow-y-auto leading-snug"
          style={{ maxHeight: 140 }}
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
  );
}

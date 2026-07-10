'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Send, Loader2, NotebookPen } from 'lucide-react';

type Msg = { role: 'user' | 'system'; content: string };

// Nhận diện ý định theo tiền tố "lưu:" / "hỏi:"
function parseIntent(raw: string): { action: 'save' | 'ask' | 'unknown'; content: string } {
  const t = raw.trim();
  const m = t.match(/^(lưu|luu|hỏi|hoi)\s*[:：]\s*([\s\S]*)$/i);
  if (m) {
    const key = m[1].toLowerCase();
    const action = (key === 'lưu' || key === 'luu') ? 'save' : 'ask';
    return { action, content: m[2].trim() };
  }
  return { action: 'unknown', content: t };
}

export default function JournalPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (user && user.role !== 'admin') router.push('/');
  }, [user, router]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, loading]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  async function send() {
    const raw = input.trim();
    if (!raw || loading) return;
    const { action, content } = parseIntent(raw);

    setMsgs(m => [...m, { role: 'user', content: raw }]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    if (action === 'unknown') {
      setMsgs(m => [...m, { role: 'system', content: 'Bạn muốn LƯU hay HỎI? Gõ lại với "lưu:" ở đầu để ghi, hoặc "hỏi:" ở đầu để tra cứu nhật ký nhé.' }]);
      return;
    }
    if (!content) {
      setMsgs(m => [...m, { role: 'system', content: action === 'save' ? 'Bạn chưa ghi nội dung sau "lưu:".' : 'Bạn chưa ghi câu hỏi sau "hỏi:".' }]);
      return;
    }

    setLoading(true);
    try {
      if (action === 'save') {
        const { error } = await supabase.from('journal_entries').insert([{ content }]);
        setMsgs(m => [...m, { role: 'system', content: error ? '⚠️ Lỗi khi lưu — bảng journal_entries đã tạo chưa?' : '✅ Đã lưu vào nhật ký.' }]);
      } else {
        const res = await fetch('/api/journal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: content }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.answer) {
          setMsgs(m => [...m, { role: 'system', content: data.error === 'no_api_key' ? '⚠️ Chưa cấu hình GEMINI_API_KEY.' : '⚠️ Chưa hỏi được, thử lại nhé.' }]);
        } else {
          setMsgs(m => [...m, { role: 'system', content: data.answer }]);
        }
      }
    } catch {
      setMsgs(m => [...m, { role: 'system', content: '⚠️ Có lỗi, thử lại nhé.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-5 py-3 shrink-0 flex items-center gap-2">
        <NotebookPen className="text-indigo-600" size={22} />
        <div>
          <h1 className="text-lg font-bold text-gray-800 leading-tight">Nhật ký</h1>
          <p className="text-xs text-gray-500">Gõ <b>lưu:</b> để ghi, <b>hỏi:</b> để tra cứu</p>
        </div>
      </div>

      {/* Hội thoại */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {msgs.length === 0 && !loading && (
          <div className="max-w-md mx-auto text-center text-gray-400 pt-8 text-sm">
            <div className="text-4xl mb-3">📔</div>
            <p className="mb-2">Ví dụ:</p>
            <p className="text-gray-500"><b>lưu:</b> hôm nay em Bình xin nghỉ 1 tuần</p>
            <p className="text-gray-500"><b>hỏi:</b> tuần này tôi ghi gì?</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
              ${m.role === 'user'
                ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white rounded-br-md shadow-md'
                : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md shadow-sm'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <Loader2 size={16} className="animate-spin text-indigo-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Ô nhập */}
      <div className="border-t border-gray-200 bg-white px-3 py-3 flex gap-2 items-end shrink-0">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); autoGrow(e.target); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={loading}
          rows={1}
          placeholder='lưu: ... hoặc hỏi: ...'
          className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 resize-none overflow-y-auto leading-snug"
          style={{ maxHeight: 140 }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:scale-100 shadow-md shrink-0"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

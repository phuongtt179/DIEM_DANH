'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Send, Loader2, NotebookPen, List, MessageSquare, Star, Pencil, Trash2, Check, X } from 'lucide-react';

type Msg = { role: 'user' | 'system'; content: string };
interface Entry { id: string; content: string; created_at: string; tags: string[] | null; is_favorite: boolean; }

// Nhận diện ý định theo tiền tố "lưu:" / "hỏi:"
function parseIntent(raw: string): { action: 'save' | 'ask' | 'unknown'; content: string } {
  const m = raw.trim().match(/^(lưu|luu|hỏi|hoi)\s*[:：]\s*([\s\S]*)$/i);
  if (m) {
    const key = m[1].toLowerCase();
    return { action: (key === 'lưu' || key === 'luu') ? 'save' : 'ask', content: m[2].trim() };
  }
  return { action: 'unknown', content: raw.trim() };
}

// Tách #nhãn từ nội dung
function extractTags(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/#([\p{L}\p{N}_]+)/gu) || []).map(t => t.slice(1))));
}

function fmt(s: string) {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function JournalPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'chat' | 'list'>('chat');

  // Chat
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Danh sách
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [filterTag, setFilterTag] = useState<string>('all'); // 'all' | 'fav' | tag
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => { if (user && user.role !== 'admin') router.push('/'); }, [user, router]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, loading]);
  useEffect(() => { if (tab === 'list') loadEntries(); }, [tab]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  async function loadEntries() {
    setLoadingList(true);
    const { data } = await supabase.from('journal_entries').select('*').order('created_at', { ascending: false }).limit(300);
    setEntries((data || []) as Entry[]);
    setLoadingList(false);
  }

  async function send() {
    const raw = input.trim();
    if (!raw || loading) return;
    const { action, content } = parseIntent(raw);
    setMsgs(m => [...m, { role: 'user', content: raw }]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    if (action === 'unknown') {
      setMsgs(m => [...m, { role: 'system', content: 'Bạn muốn LƯU hay HỎI? Gõ lại với "lưu:" để ghi, hoặc "hỏi:" để tra cứu nhé.' }]);
      return;
    }
    if (!content) {
      setMsgs(m => [...m, { role: 'system', content: action === 'save' ? 'Bạn chưa ghi nội dung sau "lưu:".' : 'Bạn chưa ghi câu hỏi sau "hỏi:".' }]);
      return;
    }

    setLoading(true);
    try {
      if (action === 'save') {
        const tags = extractTags(content);
        const { error } = await supabase.from('journal_entries').insert([{ content, tags }]);
        setMsgs(m => [...m, { role: 'system', content: error ? '⚠️ Lỗi khi lưu — đã chạy SQL thêm cột tags/is_favorite chưa?' : `✅ Đã lưu${tags.length ? ' (nhãn: ' + tags.join(', ') + ')' : ''}.` }]);
      } else {
        const res = await fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: content }) });
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

  async function toggleFav(e: Entry) {
    await supabase.from('journal_entries').update({ is_favorite: !e.is_favorite }).eq('id', e.id);
    setEntries(list => list.map(x => x.id === e.id ? { ...x, is_favorite: !x.is_favorite } : x));
  }
  async function removeEntry(id: string) {
    if (!confirm('Xóa mục nhật ký này?')) return;
    await supabase.from('journal_entries').delete().eq('id', id);
    setEntries(list => list.filter(x => x.id !== id));
  }
  function startEdit(e: Entry) { setEditingId(e.id); setEditText(e.content); }
  async function saveEdit(id: string) {
    const c = editText.trim();
    if (!c) return;
    const tags = extractTags(c);
    await supabase.from('journal_entries').update({ content: c, tags }).eq('id', id);
    setEntries(list => list.map(x => x.id === id ? { ...x, content: c, tags } : x));
    setEditingId(null);
  }

  const allTags = Array.from(new Set(entries.flatMap(e => e.tags || []))).sort();
  const shown = entries.filter(e =>
    filterTag === 'all' ? true : filterTag === 'fav' ? e.is_favorite : (e.tags || []).includes(filterTag)
  );

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-50">
      {/* Header + tabs */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <NotebookPen className="text-indigo-600" size={20} />
          <h1 className="text-lg font-bold text-gray-800">Nhật ký</h1>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setTab('chat')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === 'chat' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'}`}>
            <MessageSquare size={15} /> Ghi & Hỏi
          </button>
          <button onClick={() => setTab('list')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === 'list' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'}`}>
            <List size={15} /> Danh sách
          </button>
        </div>
      </div>

      {/* TAB CHAT */}
      {tab === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
            {msgs.length === 0 && !loading && (
              <div className="max-w-md mx-auto text-center text-gray-400 pt-8 text-sm">
                <div className="text-4xl mb-3">📔</div>
                <p className="text-gray-500"><b>lưu:</b> hôm nay thay nhớt xe AB #xe</p>
                <p className="text-gray-500"><b>hỏi:</b> tuần này ghi gì? / hỏi: #xe</p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white rounded-br-md shadow-md' : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md shadow-sm'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm"><Loader2 size={16} className="animate-spin text-indigo-400" /></div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="border-t border-gray-200 bg-white px-3 py-3 flex gap-2 items-end shrink-0">
            <textarea
              ref={inputRef} value={input}
              onChange={e => { setInput(e.target.value); autoGrow(e.target); }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={loading} rows={1} placeholder='lưu: ... hoặc hỏi: ...'
              className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 resize-none overflow-y-auto leading-snug"
              style={{ maxHeight: 140 }}
            />
            <button onClick={send} disabled={!input.trim() || loading} className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white hover:scale-105 active:scale-95 disabled:opacity-40 disabled:scale-100 shadow-md shrink-0">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </>
      )}

      {/* TAB DANH SÁCH */}
      {tab === 'list' && (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Bộ lọc */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button onClick={() => setFilterTag('all')} className={`px-2.5 py-1 rounded-full text-xs font-semibold ${filterTag === 'all' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>Tất cả</button>
            <button onClick={() => setFilterTag('fav')} className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${filterTag === 'fav' ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}><Star size={12} /> Yêu thích</button>
            {allTags.map(t => (
              <button key={t} onClick={() => setFilterTag(t)} className={`px-2.5 py-1 rounded-full text-xs font-semibold ${filterTag === t ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>#{t}</button>
            ))}
          </div>

          {loadingList ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-indigo-400" /></div>
          ) : shown.length === 0 ? (
            <div className="text-center text-gray-400 py-10 bg-white rounded-xl shadow">Không có mục nào.</div>
          ) : (
            <div className="space-y-2">
              {shown.map(e => (
                <div key={e.id} className="bg-white rounded-xl shadow-sm p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">{fmt(e.created_at)}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleFav(e)} aria-label="Yêu thích" className={e.is_favorite ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}>
                        <Star size={16} fill={e.is_favorite ? 'currentColor' : 'none'} />
                      </button>
                      {editingId === e.id ? (
                        <>
                          <button onClick={() => saveEdit(e.id)} className="text-green-600" aria-label="Lưu"><Check size={16} /></button>
                          <button onClick={() => setEditingId(null)} className="text-gray-400" aria-label="Hủy"><X size={16} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(e)} className="text-gray-300 hover:text-blue-500" aria-label="Sửa"><Pencil size={15} /></button>
                          <button onClick={() => removeEntry(e.id)} className="text-gray-300 hover:text-red-500" aria-label="Xóa"><Trash2 size={15} /></button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingId === e.id ? (
                    <textarea value={editText} onChange={ev => setEditText(ev.target.value)} rows={2}
                      className="w-full border-2 border-indigo-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-400 resize-none" />
                  ) : (
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{e.content}</p>
                  )}
                  {editingId !== e.id && e.tags && e.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {e.tags.map(t => <span key={t} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-xs">#{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

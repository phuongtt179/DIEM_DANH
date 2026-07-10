'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Save, Search, Trash2, Loader2, NotebookPen, Sparkles } from 'lucide-react';

interface Entry {
  id: string;
  content: string;
  created_at: string;
}

function fmt(s: string) {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function JournalPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState('');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (user && user.role !== 'admin') router.push('/');
  }, [user, router]);

  useEffect(() => { loadEntries(); }, []);

  async function loadEntries() {
    setLoading(true);
    const { data } = await supabase
      .from('journal_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setEntries(data || []);
    setLoading(false);
  }

  async function save() {
    const c = text.trim();
    if (!c || saving) return;
    setSaving(true);
    setErrMsg('');
    const { error } = await supabase.from('journal_entries').insert([{ content: c }]);
    setSaving(false);
    if (error) { setErrMsg('Lỗi khi lưu — bảng journal_entries đã tạo chưa?'); return; }
    setText('');
    setAnswer('');
    loadEntries();
  }

  async function ask() {
    const q = text.trim();
    if (!q || asking) return;
    setAsking(true);
    setErrMsg('');
    setAnswer('');
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.answer) {
        setErrMsg(data.error === 'no_api_key' ? 'Chưa cấu hình GEMINI_API_KEY.' : 'Chưa hỏi được, thử lại nhé.');
        return;
      }
      setAnswer(data.answer);
    } catch {
      setErrMsg('Có lỗi mạng, thử lại nhé.');
    } finally {
      setAsking(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Xóa mục nhật ký này?')) return;
    await supabase.from('journal_entries').delete().eq('id', id);
    loadEntries();
  }

  const busy = saving || asking;

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-5 flex items-center gap-2">
        <NotebookPen className="text-indigo-600" size={26} />
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Nhật ký</h1>
          <p className="text-sm text-gray-600">Ghi lại và hỏi lại — chỉ tìm trong nhật ký của bạn</p>
        </div>
      </div>

      {/* Ô nhập chung + 2 nút */}
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          placeholder="Gõ nội dung để LƯU, hoặc gõ câu hỏi để HỎI nhật ký…"
          className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none resize-none"
        />
        <div className="flex gap-3 mt-3">
          <button
            onClick={save}
            disabled={!text.trim() || busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700 disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Lưu
          </button>
          <button
            onClick={ask}
            disabled={!text.trim() || busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:opacity-40"
          >
            {asking ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Hỏi
          </button>
        </div>
        {errMsg && <p className="text-xs text-red-600 font-semibold mt-2 text-center">{errMsg}</p>}
      </div>

      {/* Trả lời khi hỏi */}
      {answer && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-4 flex gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white shrink-0">
            <Sparkles size={15} />
          </div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{answer}</div>
        </div>
      )}

      {/* Danh sách nhật ký */}
      <h2 className="text-sm font-bold text-gray-500 uppercase mb-2 mt-6">Đã ghi ({entries.length})</h2>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-indigo-400" /></div>
      ) : entries.length === 0 ? (
        <div className="text-center text-gray-400 py-10 bg-white rounded-xl shadow">Chưa có mục nhật ký nào.</div>
      ) : (
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.id} className="bg-white rounded-xl shadow-sm p-3 flex gap-3 group">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 mb-1">{fmt(e.created_at)}</p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{e.content}</p>
              </div>
              <button
                onClick={() => remove(e.id)}
                className="text-gray-300 hover:text-red-500 shrink-0 self-start"
                aria-label="Xóa"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

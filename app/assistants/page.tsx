'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Edit2, Trash2, X, GraduationCap, ClipboardList, BarChart3, Save } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

interface Assistant {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
}

interface ClassItem {
  id: string;
  name: string;
  subject: string;
}

// Lưới điểm danh theo tháng: grid[class_id][day] = { status, id }
type CellStatus = 'present' | 'absent';
interface GridCell { status: CellStatus; id: string | null; }
type AttGrid = Record<string, Record<number, GridCell>>;

interface StatRow {
  assistant_id: string;
  assistant_name: string;
  class_id: string;
  class_name: string;
  total_sessions: number;
}

interface PaymentRecord {
  id: string;
  assistant_id: string;
  month: string;
  amount: number;
  paid_at: string;
}

type Tab = 'list' | 'attendance' | 'stats';

export default function AssistantsPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('list');
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);

  // List tab state
  const [showModal, setShowModal] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', note: '' });
  const [assignedClassIds, setAssignedClassIds] = useState<string[]>([]);
  const [assistantClassMap, setAssistantClassMap] = useState<Record<string, string[]>>({});

  // Attendance tab state (lưới theo tháng)
  const [attMonth, setAttMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [attAssistantId, setAttAssistantId] = useState('');
  const [grid, setGrid] = useState<AttGrid>({});
  const [gridDraft, setGridDraft] = useState<AttGrid>({});
  const [gridEdit, setGridEdit] = useState(false);
  const [savingGrid, setSavingGrid] = useState(false);
  const [loadingGrid, setLoadingGrid] = useState(false);

  // Stats tab state
  const [statsMonth, setStatsMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [statsRows, setStatsRows] = useState<StatRow[]>([]);
  const [payments, setPayments] = useState<Record<string, PaymentRecord>>({});
  const [loadingStats, setLoadingStats] = useState(false);

  // Payment modal state
  const [showPayModal, setShowPayModal] = useState(false);
  const [payingAssistant, setPayingAssistant] = useState<{ id: string; name: string; total: number } | null>(null);
  const [payInput, setPayInput] = useState('');

  useEffect(() => {
    if (!hasPermission('manage_assistants')) {
      router.push('/');
    }
  }, [hasPermission, router]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (tab === 'stats') loadStats();
  }, [tab, statsMonth]);

  useEffect(() => {
    setGridEdit(false);
    if (attAssistantId && attMonth) loadGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attAssistantId, attMonth, assistantClassMap]);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: aData }, { data: cData }, { data: acData }] = await Promise.all([
        supabase.from('assistants').select('*').order('name'),
        supabase.from('classes').select('id, name, subject').eq('status', 'active').order('name'),
        supabase.from('assistant_classes').select('assistant_id, class_id'),
      ]);
      setAssistants(aData || []);
      setClasses(cData || []);
      const map: Record<string, string[]> = {};
      (acData || []).forEach((r: any) => {
        if (!map[r.assistant_id]) map[r.assistant_id] = [];
        map[r.assistant_id].push(r.class_id);
      });
      setAssistantClassMap(map);
      if (!attAssistantId && aData && aData.length > 0) {
        setAttAssistantId(aData[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadGrid() {
    const classIds = assistantClassMap[attAssistantId] || [];
    if (classIds.length === 0) { setGrid({}); setGridDraft({}); return; }
    setLoadingGrid(true);
    try {
      const [y, mo] = attMonth.split('-').map(Number);
      const last = new Date(y, mo, 0).getDate();
      const start = `${attMonth}-01`;
      const end = `${attMonth}-${String(last).padStart(2, '0')}`;
      const { data } = await supabase
        .from('assistant_sessions')
        .select('id, class_id, date, status, sessions_count')
        .eq('assistant_id', attAssistantId)
        .gte('date', start).lte('date', end)
        .in('class_id', classIds);

      const g: AttGrid = {};
      classIds.forEach(cid => { g[cid] = {}; });
      (data || []).forEach((r: any) => {
        const day = parseInt(String(r.date).slice(8, 10));
        const status: CellStatus = r.status ? r.status : (r.sessions_count > 0 ? 'present' : 'absent');
        if (!g[r.class_id]) g[r.class_id] = {};
        g[r.class_id][day] = { status, id: r.id };
      });
      setGrid(g);
      setGridDraft(JSON.parse(JSON.stringify(g)));
    } finally {
      setLoadingGrid(false);
    }
  }

  // Bấm ô (khi đang chỉnh sửa): trống → ✓ đi dạy → ✗ vắng → trống
  function toggleCell(cid: string, day: number) {
    if (!gridEdit) return;
    setGridDraft(prev => {
      const g: AttGrid = { ...prev, [cid]: { ...(prev[cid] || {}) } };
      const cur = g[cid][day];
      if (!cur) g[cid][day] = { status: 'present', id: null };
      else if (cur.status === 'present') g[cid][day] = { status: 'absent', id: cur.id };
      else delete g[cid][day];
      return g;
    });
  }

  async function saveGrid() {
    setSavingGrid(true);
    try {
      const classIds = assistantClassMap[attAssistantId] || [];
      const ops: Promise<any>[] = [];
      for (const cid of classIds) {
        const orig = grid[cid] || {};
        const draft = gridDraft[cid] || {};
        const days = new Set<number>([...Object.keys(orig), ...Object.keys(draft)].map(Number));
        for (const day of days) {
          const o = orig[day];
          const d = draft[day];
          const date = `${attMonth}-${String(day).padStart(2, '0')}`;
          if (!d && o) {
            ops.push(Promise.resolve(supabase.from('assistant_sessions').delete().eq('id', o.id)));
          } else if (d && !o) {
            ops.push(Promise.resolve(supabase.from('assistant_sessions').insert({
              assistant_id: attAssistantId, class_id: cid, date,
              status: d.status, sessions_count: d.status === 'present' ? 1 : 0, note: null,
            })));
          } else if (d && o && d.status !== o.status && o.id) {
            ops.push(Promise.resolve(supabase.from('assistant_sessions').update({
              status: d.status, sessions_count: d.status === 'present' ? 1 : 0,
            }).eq('id', o.id)));
          }
        }
      }
      await Promise.all(ops);
      setGridEdit(false);
      await loadGrid();
    } catch {
      alert('Lỗi khi lưu điểm danh');
    } finally {
      setSavingGrid(false);
    }
  }

  async function loadStats() {
    setLoadingStats(true);
    try {
      const startDate = `${statsMonth}-01`;
      const [year, month] = statsMonth.split('-');
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDate = `${statsMonth}-${String(lastDay).padStart(2, '0')}`;

      const [{ data }, { data: payData }] = await Promise.all([
        supabase
          .from('assistant_sessions')
          .select(`assistant_id, class_id, sessions_count, assistants (name), classes (name)`)
          .gte('date', startDate)
          .lte('date', endDate),
        supabase
          .from('assistant_payments')
          .select('*')
          .eq('month', statsMonth),
      ]);

      const grouped: Record<string, StatRow> = {};
      (data || []).forEach((r: any) => {
        const key = `${r.assistant_id}-${r.class_id}`;
        if (!grouped[key]) {
          grouped[key] = {
            assistant_id: r.assistant_id,
            assistant_name: r.assistants?.name || '',
            class_id: r.class_id,
            class_name: r.classes?.name || '',
            total_sessions: 0,
          };
        }
        grouped[key].total_sessions += r.sessions_count;
      });
      setStatsRows(Object.values(grouped).sort((a, b) => a.assistant_name.localeCompare(b.assistant_name)));

      const payMap: Record<string, PaymentRecord> = {};
      (payData || []).forEach((p: any) => { payMap[p.assistant_id] = p; });
      setPayments(payMap);
    } finally {
      setLoadingStats(false);
    }
  }

  async function handlePay() {
    if (!payingAssistant) return;
    const amount = parseInt(payInput.replace(/\D/g, ''));
    if (!amount) { alert('Vui lòng nhập số tiền'); return; }
    try {
      await supabase.from('assistant_payments').upsert({
        assistant_id: payingAssistant.id,
        month: statsMonth,
        amount,
      }, { onConflict: 'assistant_id,month' });
      setShowPayModal(false);
      setPayInput('');
      loadStats();
    } catch {
      alert('Lỗi khi lưu thanh toán');
    }
  }

  async function handleUnpay(assistantId: string) {
    if (!confirm('Bỏ đánh dấu đã thanh toán?')) return;
    await supabase.from('assistant_payments').delete()
      .eq('assistant_id', assistantId).eq('month', statsMonth);
    loadStats();
  }

  function openAdd() {
    setEditingAssistant(null);
    setFormData({ name: '', phone: '', note: '' });
    setAssignedClassIds([]);
    setShowModal(true);
  }

  function openEdit(a: Assistant) {
    setEditingAssistant(a);
    setFormData({ name: a.name, phone: a.phone || '', note: a.note || '' });
    setAssignedClassIds(assistantClassMap[a.id] || []);
    setShowModal(true);
  }

  async function handleSave() {
    if (!formData.name.trim()) { alert('Vui lòng nhập tên trợ giảng'); return; }
    try {
      let id: string;
      if (editingAssistant) {
        await supabase.from('assistants').update({
          name: formData.name.trim(),
          phone: formData.phone || null,
          note: formData.note || null,
        }).eq('id', editingAssistant.id);
        id = editingAssistant.id;
      } else {
        const { data } = await supabase.from('assistants').insert({
          name: formData.name.trim(),
          phone: formData.phone || null,
          note: formData.note || null,
        }).select().single();
        id = data.id;
      }

      // Sync assigned classes
      await supabase.from('assistant_classes').delete().eq('assistant_id', id);
      if (assignedClassIds.length > 0) {
        await supabase.from('assistant_classes').insert(
          assignedClassIds.map(cid => ({ assistant_id: id, class_id: cid }))
        );
      }

      setShowModal(false);
      loadData();
    } catch (e) {
      alert('Lỗi khi lưu');
    }
  }

  async function handleDelete(a: Assistant) {
    if (!confirm(`Xóa trợ giảng "${a.name}"? Toàn bộ dữ liệu điểm danh sẽ bị xóa.`)) return;
    await supabase.from('assistants').delete().eq('id', a.id);
    loadData();
  }

  const attAssistant = assistants.find(a => a.id === attAssistantId);

  // Pivot: unique classes that appear in statsRows
  const pivotClasses: { id: string; name: string }[] = [];
  const seenClassIds = new Set<string>();
  statsRows.forEach(r => {
    if (!seenClassIds.has(r.class_id)) {
      seenClassIds.add(r.class_id);
      pivotClasses.push({ id: r.class_id, name: r.class_name });
    }
  });

  // Pivot: group by assistant
  const pivotByAssistant: Record<string, { name: string; sessions: Record<string, number> }> = {};
  statsRows.forEach(r => {
    if (!pivotByAssistant[r.assistant_id]) {
      pivotByAssistant[r.assistant_id] = { name: r.assistant_name, sessions: {} };
    }
    pivotByAssistant[r.assistant_id].sessions[r.class_id] = r.total_sessions;
  });
  const pivotAssistants = Object.entries(pivotByAssistant).map(([id, val]) => ({
    id,
    name: val.name,
    sessions: val.sessions,
    total: Object.values(val.sessions).reduce((s, n) => s + n, 0),
  }));
  const RATE = 100000;

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Trợ giảng</h1>
        <p className="text-sm lg:text-base text-gray-600 mt-1">Quản lý trợ giảng và điểm danh buổi dạy</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setTab('list')}
          className={`flex items-center gap-2 px-4 lg:px-6 py-2 lg:py-3 font-semibold text-sm lg:text-base transition-colors ${tab === 'list' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <GraduationCap size={18} />
          Danh sách
        </button>
        <button
          onClick={() => setTab('attendance')}
          className={`flex items-center gap-2 px-4 lg:px-6 py-2 lg:py-3 font-semibold text-sm lg:text-base transition-colors ${tab === 'attendance' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <ClipboardList size={18} />
          Điểm danh
        </button>
        <button
          onClick={() => setTab('stats')}
          className={`flex items-center gap-2 px-4 lg:px-6 py-2 lg:py-3 font-semibold text-sm lg:text-base transition-colors ${tab === 'stats' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <BarChart3 size={18} />
          Thống kê lương
        </button>
      </div>

      {/* ====== TAB: DANH SÁCH ====== */}
      {tab === 'list' && (
        <div>
          <button
            onClick={openAdd}
            className="mb-4 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm"
          >
            <Plus size={18} />
            Thêm trợ giảng
          </button>

          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>
          ) : assistants.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow text-gray-500">Chưa có trợ giảng nào</div>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-bold text-gray-700">Họ tên</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-gray-700">SĐT</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-gray-700">Lớp phụ trách</th>
                    <th className="px-4 py-3 text-left text-sm font-bold text-gray-700">Ghi chú</th>
                    <th className="px-4 py-3 text-center text-sm font-bold text-gray-700">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {assistants.map(a => {
                    const classIds = assistantClassMap[a.id] || [];
                    const classNames = classIds.map(id => classes.find(c => c.id === id)?.name || id);
                    return (
                      <tr key={a.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold text-gray-800">{a.name}</td>
                        <td className="px-4 py-3 text-gray-600">{a.phone || '-'}</td>
                        <td className="px-4 py-3">
                          {classNames.length > 0
                            ? <div className="flex flex-wrap gap-1">{classNames.map(n => <span key={n} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">{n}</span>)}</div>
                            : <span className="text-gray-400 text-sm">Chưa phân công</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-sm">{a.note || '-'}</td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={() => openEdit(a)} className="text-blue-500 hover:text-blue-700 mr-3"><Edit2 size={18} /></button>
                          <button onClick={() => handleDelete(a)} className="text-red-500 hover:text-red-700"><Trash2 size={18} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ====== TAB: ĐIỂM DANH (lưới theo tháng) ====== */}
      {tab === 'attendance' && (() => {
        const gridClasses = (assistantClassMap[attAssistantId] || [])
          .map(cid => ({ id: cid, name: classes.find(c => c.id === cid)?.name || cid }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const [gy, gm] = attMonth.split('-').map(Number);
        const gLast = new Date(gy, gm, 0).getDate();
        const gDays = Array.from({ length: gLast }, (_, i) => i + 1);
        const gDow = (d: number) => new Date(Date.UTC(gy, gm - 1, d)).getUTCDay(); // 0 = CN
        const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        const src = gridEdit ? gridDraft : grid;

        return (
          <div className="bg-white rounded-xl shadow p-4 lg:p-6">
            <div className="flex flex-col lg:flex-row lg:items-end gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Trợ giảng</label>
                <select
                  value={attAssistantId}
                  onChange={e => setAttAssistantId(e.target.value)}
                  className="px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
                >
                  <option value="">-- Chọn trợ giảng --</option>
                  {assistants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Tháng</label>
                <input
                  type="month"
                  value={attMonth}
                  onChange={e => setAttMonth(e.target.value)}
                  className="px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
                />
              </div>
              <div className="flex gap-2 lg:ml-auto">
                {!gridEdit ? (
                  <button
                    onClick={() => { setGridDraft(JSON.parse(JSON.stringify(grid))); setGridEdit(true); }}
                    disabled={!attAssistantId || gridClasses.length === 0}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Edit2 size={16} /> Chỉnh sửa
                  </button>
                ) : (
                  <>
                    <button onClick={saveGrid} disabled={savingGrid}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
                      <Save size={16} /> {savingGrid ? 'Đang lưu...' : 'Lưu'}
                    </button>
                    <button onClick={() => { setGridDraft(JSON.parse(JSON.stringify(grid))); setGridEdit(false); }}
                      className="px-4 py-2 border-2 border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50">
                      Hủy
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mb-3">
              <span className="flex items-center gap-1"><span className="text-green-600 font-bold">✓</span> đi dạy</span>
              <span className="flex items-center gap-1"><span className="text-red-500 font-bold">✗</span> vắng</span>
              {gridEdit && <span className="text-blue-600 font-medium">Bấm ô để đổi: trống → ✓ → ✗ → trống</span>}
            </div>

            {!attAssistantId ? (
              <p className="text-gray-500 text-center py-8">Chọn trợ giảng để xem bảng điểm danh</p>
            ) : gridClasses.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{attAssistant?.name} chưa được phân công lớp nào</p>
            ) : loadingGrid ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-gray-50 border border-gray-200 px-3 py-1.5 text-left font-bold text-gray-700 min-w-[120px]">Lớp</th>
                      {gDays.map(d => {
                        const sun = gDow(d) === 0;
                        return (
                          <th key={d} className={`border border-gray-200 px-1 py-1 text-center min-w-[34px] ${sun ? 'bg-red-100 text-red-600' : 'text-gray-600'}`}>
                            <div className="text-[13px] font-bold leading-none">{d}</div>
                            <div className="text-[10px] font-medium opacity-70">{WD[gDow(d)]}</div>
                          </th>
                        );
                      })}
                      <th className="border border-gray-200 px-2 py-1 text-center font-bold text-gray-700 min-w-[46px]">Buổi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridClasses.map(c => {
                      const row = src[c.id] || {};
                      const count = Object.values(row).filter(x => x.status === 'present').length;
                      return (
                        <tr key={c.id}>
                          <td className="sticky left-0 z-10 bg-white border border-gray-200 px-3 py-1.5 font-semibold text-gray-800 min-w-[120px]">{c.name}</td>
                          {gDays.map(d => {
                            const sun = gDow(d) === 0;
                            const cell = row[d];
                            return (
                              <td key={d} onClick={() => toggleCell(c.id, d)}
                                className={`border border-gray-200 text-center h-8 select-none ${sun ? 'bg-red-50' : ''} ${gridEdit ? 'cursor-pointer hover:bg-blue-50' : ''}`}>
                                {cell?.status === 'present' ? <span className="text-green-600 font-bold">✓</span>
                                  : cell?.status === 'absent' ? <span className="text-red-500 font-bold">✗</span> : ''}
                              </td>
                            );
                          })}
                          <td className="border border-gray-200 text-center font-bold text-blue-700 bg-blue-50/40">{count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ====== TAB: THỐNG KÊ LƯƠNG ====== */}
      {tab === 'stats' && (
        <div className="bg-white rounded-xl shadow p-4 lg:p-6">
          <div className="flex items-center gap-4 mb-6">
            <label className="text-sm font-semibold text-gray-700">Tháng:</label>
            <input
              type="month"
              value={statsMonth}
              onChange={e => setStatsMonth(e.target.value)}
              className="px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>

          {loadingStats ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>
          ) : pivotAssistants.length === 0 ? (
            <p className="text-center py-12 text-gray-500">Không có dữ liệu tháng {statsMonth.split('-')[1]}/{statsMonth.split('-')[0]}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="border border-gray-200 px-3 py-2 text-left font-bold text-gray-700 min-w-[130px]">Trợ giảng</th>
                    {pivotClasses.map(c => (
                      <th key={c.id} className="border border-gray-200 px-3 py-2 text-center font-bold text-gray-700 min-w-[80px]">{c.name}</th>
                    ))}
                    <th className="border border-gray-200 px-3 py-2 text-center font-bold text-gray-700 min-w-[90px]">Tổng buổi</th>
                    <th className="border border-gray-200 px-3 py-2 text-center font-bold text-gray-700 min-w-[120px]">Thành tiền</th>
                    <th className="border border-gray-200 px-3 py-2 text-center font-bold text-gray-700 min-w-[150px]">Thanh toán</th>
                  </tr>
                </thead>
                <tbody>
                  {pivotAssistants.map(a => {
                    const pay = payments[a.id];
                    return (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="border border-gray-200 px-3 py-2 font-semibold text-gray-800">{a.name}</td>
                        {pivotClasses.map(c => (
                          <td key={c.id} className="border border-gray-200 px-3 py-2 text-center text-blue-700 font-bold">
                            {a.sessions[c.id] || '-'}
                          </td>
                        ))}
                        <td className="border border-gray-200 px-3 py-2 text-center font-bold text-gray-800">{a.total}</td>
                        <td className="border border-gray-200 px-3 py-2 text-center font-bold text-green-700">
                          {(a.total * RATE).toLocaleString('vi-VN')} đ
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-center">
                          {pay ? (
                            <div>
                              <div className="text-green-600 font-semibold text-xs">✓ Đã thanh toán</div>
                              <div className="text-green-700 font-bold">{pay.amount.toLocaleString('vi-VN')} đ</div>
                              <button
                                onClick={() => handleUnpay(a.id)}
                                className="text-xs text-gray-400 hover:text-red-500 mt-0.5"
                              >
                                Bỏ xác nhận
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setPayingAssistant({ id: a.id, name: a.name, total: a.total });
                                setPayInput((a.total * RATE).toString());
                                setShowPayModal(true);
                              }}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700"
                            >
                              Thanh toán
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                  <tr>
                    <td className="border border-gray-200 px-3 py-2 font-bold text-gray-700">Tổng</td>
                    {pivotClasses.map(c => (
                      <td key={c.id} className="border border-gray-200 px-3 py-2 text-center font-bold text-gray-700">
                        {pivotAssistants.reduce((s, a) => s + (a.sessions[c.id] || 0), 0)}
                      </td>
                    ))}
                    <td className="border border-gray-200 px-3 py-2 text-center font-bold text-gray-800">
                      {pivotAssistants.reduce((s, a) => s + a.total, 0)}
                    </td>
                    <td className="border border-gray-200 px-3 py-2 text-center font-bold text-green-700">
                      {(pivotAssistants.reduce((s, a) => s + a.total, 0) * RATE).toLocaleString('vi-VN')} đ
                    </td>
                    <td className="border border-gray-200" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ====== MODAL THANH TOÁN ====== */}
      {showPayModal && payingAssistant && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-bold text-gray-800">Xác nhận thanh toán</h2>
              <button onClick={() => setShowPayModal(false)} className="text-gray-400 hover:text-gray-600"><X size={22} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 space-y-1">
                <div><span className="font-semibold">Trợ giảng:</span> {payingAssistant.name}</div>
                <div><span className="font-semibold">Tháng:</span> {statsMonth.split('-')[1]}/{statsMonth.split('-')[0]}</div>
                <div><span className="font-semibold">Số buổi:</span> {payingAssistant.total} buổi × 100.000 đ</div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Số tiền thanh toán</label>
                <input
                  type="text"
                  value={parseInt(payInput || '0').toLocaleString('vi-VN')}
                  onChange={e => setPayInput(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm font-semibold"
                />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t">
              <button onClick={() => setShowPayModal(false)} className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg text-gray-700 font-semibold text-sm hover:bg-gray-50">Hủy</button>
              <button onClick={handlePay} className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700">Xác nhận đã trả</button>
            </div>
          </div>
        </div>
      )}

      {/* ====== MODAL THÊM/SỬA TRỢ GIẢNG ====== */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-bold text-gray-800">
                {editingAssistant ? 'Sửa trợ giảng' : 'Thêm trợ giảng'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Họ tên <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
                  placeholder="Nhập họ tên"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Số điện thoại</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
                  placeholder="Nhập SĐT"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={formData.note}
                  onChange={e => setFormData({ ...formData, note: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
                  placeholder="Ghi chú thêm"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Phân công lớp</label>
                <div className="border-2 border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto bg-gray-50 space-y-1">
                  {classes.map(c => (
                    <label key={c.id} className="flex items-center gap-2 p-2 hover:bg-white rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={assignedClassIds.includes(c.id)}
                        onChange={e => {
                          if (e.target.checked) setAssignedClassIds([...assignedClassIds, c.id]);
                          else setAssignedClassIds(assignedClassIds.filter(id => id !== c.id));
                        }}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      <span className="text-sm text-gray-700">{c.name} ({c.subject})</span>
                    </label>
                  ))}
                  {classes.length === 0 && <p className="text-sm text-gray-500 text-center py-2">Chưa có lớp nào</p>}
                </div>
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t">
              <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg text-gray-700 font-semibold text-sm hover:bg-gray-50">Hủy</button>
              <button onClick={handleSave} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700">Lưu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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

interface SessionInput {
  class_id: string;
  class_name: string;
  sessions_count: number;
  existing_id: string | null;
  note: string;
}

interface StatRow {
  assistant_id: string;
  assistant_name: string;
  class_id: string;
  class_name: string;
  total_sessions: number;
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

  // Attendance tab state
  const [attDate, setAttDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [attAssistantId, setAttAssistantId] = useState('');
  const [sessionInputs, setSessionInputs] = useState<SessionInput[]>([]);
  const [saving, setSaving] = useState(false);

  // Stats tab state
  const [statsMonth, setStatsMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [statsRows, setStatsRows] = useState<StatRow[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

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
    if (attAssistantId && attDate) loadSessionInputs();
  }, [attAssistantId, attDate]);

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

  async function loadSessionInputs() {
    const classIds = assistantClassMap[attAssistantId] || [];
    if (classIds.length === 0) {
      setSessionInputs([]);
      return;
    }

    const { data: existing } = await supabase
      .from('assistant_sessions')
      .select('*')
      .eq('assistant_id', attAssistantId)
      .eq('date', attDate)
      .in('class_id', classIds);

    const inputs: SessionInput[] = classIds.map(cid => {
      const cls = classes.find(c => c.id === cid);
      const rec = (existing || []).find((r: any) => r.class_id === cid);
      return {
        class_id: cid,
        class_name: cls ? `${cls.name} (${cls.subject})` : cid,
        sessions_count: rec ? rec.sessions_count : 0,
        existing_id: rec ? rec.id : null,
        note: rec ? (rec.note || '') : '',
      };
    });
    setSessionInputs(inputs);
  }

  async function saveAttendance() {
    setSaving(true);
    try {
      for (const inp of sessionInputs) {
        if (inp.sessions_count === 0) {
          if (inp.existing_id) {
            await supabase.from('assistant_sessions').delete().eq('id', inp.existing_id);
          }
        } else if (inp.existing_id) {
          await supabase.from('assistant_sessions').update({
            sessions_count: inp.sessions_count,
            note: inp.note || null,
          }).eq('id', inp.existing_id);
        } else {
          await supabase.from('assistant_sessions').insert({
            assistant_id: attAssistantId,
            class_id: inp.class_id,
            date: attDate,
            sessions_count: inp.sessions_count,
            note: inp.note || null,
          });
        }
      }
      alert('Đã lưu điểm danh trợ giảng!');
      loadSessionInputs();
    } catch (e) {
      alert('Lỗi khi lưu');
    } finally {
      setSaving(false);
    }
  }

  async function loadStats() {
    setLoadingStats(true);
    try {
      const startDate = `${statsMonth}-01`;
      const [year, month] = statsMonth.split('-');
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDate = `${statsMonth}-${String(lastDay).padStart(2, '0')}`;

      const { data } = await supabase
        .from('assistant_sessions')
        .select(`
          assistant_id,
          class_id,
          sessions_count,
          assistants (name),
          classes (name)
        `)
        .gte('date', startDate)
        .lte('date', endDate);

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
    } finally {
      setLoadingStats(false);
    }
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
  const statsTotalSessions = statsRows.reduce((s, r) => s + r.total_sessions, 0);

  // Group stats by assistant
  const statsByAssistant: Record<string, StatRow[]> = {};
  statsRows.forEach(r => {
    if (!statsByAssistant[r.assistant_id]) statsByAssistant[r.assistant_id] = [];
    statsByAssistant[r.assistant_id].push(r);
  });

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

      {/* ====== TAB: ĐIỂM DANH ====== */}
      {tab === 'attendance' && (
        <div className="bg-white rounded-xl shadow p-4 lg:p-6">
          <div className="flex flex-col lg:flex-row gap-4 mb-6">
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
              <label className="block text-sm font-semibold text-gray-700 mb-1">Ngày dạy</label>
              <input
                type="date"
                value={attDate}
                onChange={e => setAttDate(e.target.value)}
                className="px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
              />
            </div>
          </div>

          {!attAssistantId ? (
            <p className="text-gray-500 text-center py-8">Chọn trợ giảng để điểm danh</p>
          ) : sessionInputs.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{attAssistant?.name} chưa được phân công lớp nào</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-700 mb-3">
                {attAssistant?.name} — {format(new Date(attDate + 'T00:00:00'), 'dd/MM/yyyy')}
              </p>
              <div className="space-y-3">
                {sessionInputs.map((inp, i) => (
                  <div key={inp.class_id} className="flex flex-col lg:flex-row lg:items-center gap-3 p-3 border border-gray-200 rounded-lg">
                    <span className="font-semibold text-gray-800 lg:w-48">{inp.class_name}</span>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600">Số suất dạy:</label>
                      <div className="flex gap-1">
                        {[0, 1, 2].map(n => (
                          <button
                            key={n}
                            onClick={() => {
                              const updated = [...sessionInputs];
                              updated[i] = { ...updated[i], sessions_count: n };
                              setSessionInputs(updated);
                            }}
                            className={`w-10 h-10 rounded-lg font-bold text-sm border-2 transition-colors ${
                              inp.sessions_count === n
                                ? n === 0 ? 'bg-gray-200 border-gray-400 text-gray-700'
                                  : 'bg-blue-600 border-blue-600 text-white'
                                : 'border-gray-300 text-gray-600 hover:border-blue-400'
                            }`}
                          >
                            {n === 0 ? 'KD' : n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="text"
                      value={inp.note}
                      onChange={e => {
                        const updated = [...sessionInputs];
                        updated[i] = { ...updated[i], note: e.target.value };
                        setSessionInputs(updated);
                      }}
                      placeholder="Ghi chú..."
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={saveAttendance}
                disabled={saving}
                className="mt-4 flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold text-sm disabled:opacity-60"
              >
                <Save size={18} />
                {saving ? 'Đang lưu...' : 'Lưu điểm danh'}
              </button>
            </>
          )}
        </div>
      )}

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
          ) : statsRows.length === 0 ? (
            <p className="text-center py-12 text-gray-500">Không có dữ liệu tháng {statsMonth.split('-')[1]}/{statsMonth.split('-')[0]}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border border-gray-200 px-4 py-2 text-left text-sm font-bold text-gray-700">Trợ giảng</th>
                      <th className="border border-gray-200 px-4 py-2 text-left text-sm font-bold text-gray-700">Lớp</th>
                      <th className="border border-gray-200 px-4 py-2 text-center text-sm font-bold text-gray-700">Số suất dạy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(statsByAssistant).map(([aid, rows]) => (
                      rows.map((row, idx) => (
                        <tr key={`${aid}-${row.class_id}`} className="hover:bg-gray-50">
                          {idx === 0 && (
                            <td
                              className="border border-gray-200 px-4 py-2 font-semibold text-gray-800 align-top"
                              rowSpan={rows.length}
                            >
                              {row.assistant_name}
                              <div className="text-xs text-blue-600 font-normal mt-1">
                                Tổng: {rows.reduce((s, r) => s + r.total_sessions, 0)} suất
                              </div>
                            </td>
                          )}
                          <td className="border border-gray-200 px-4 py-2 text-gray-700">{row.class_name}</td>
                          <td className="border border-gray-200 px-4 py-2 text-center font-bold text-blue-700">{row.total_sessions}</td>
                        </tr>
                      ))
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                    <tr>
                      <td colSpan={2} className="border border-gray-200 px-4 py-2 font-bold text-gray-700 text-right">Tổng cộng:</td>
                      <td className="border border-gray-200 px-4 py-2 text-center font-bold text-blue-700">{statsTotalSessions} suất</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
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

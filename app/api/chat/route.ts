import { supabase } from '@/lib/supabase';
import { getGeminiKeys, callGeminiRotate, isDailyLimit } from '@/lib/gemini';

export const maxDuration = 30;

// Model dùng chung với dự án ONTAP TIN — dễ đổi nếu cần
const MODEL = 'gemini-3.1-flash-lite';

// ==================== HELPERS ====================

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Sinh danh sách tháng từ 'from' đến 'to' (bao gồm cả hai), dạng YYYY-MM
function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 240) {
    months.push(cur);
    const [y, m] = cur.split('-').map(Number);
    cur = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
  }
  return months;
}

// Tìm lớp theo tên (không phân biệt hoa thường, khớp một phần).
// Trả về { one } nếu khớp đúng 1 lớp, hoặc { matches } nếu nhiều/không có.
async function resolveClass(className: string) {
  const { data } = await supabase.from('classes').select('id, name, tuition, status').order('name');
  // Chuẩn hóa: thường hóa, gộp khoảng trắng thừa
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const kw = norm(className);

  // 1) Ưu tiên khớp CHÍNH XÁC tên (để "KN35 TH" không bị lẫn với "KN35 THCS")
  const exact = (data || []).filter((c: any) => norm(c.name) === kw);
  if (exact.length === 1) return { one: exact[0] };

  // 2) Không có khớp chính xác → xét khớp một phần
  const partial = (data || []).filter((c: any) => norm(c.name).includes(kw));
  if (partial.length === 1) return { one: partial[0] };

  return { matches: partial };
}

// ==================== TOOLS (chỉ đọc) ====================

async function toolListClasses() {
  const { data } = await supabase
    .from('classes')
    .select('name, subject, tuition, status')
    .order('name');
  return {
    classes: (data || []).map((c: any) => ({
      ten_lop: c.name,
      mon: c.subject,
      hoc_phi: c.tuition,
      trang_thai: c.status === 'locked' ? 'đã khóa' : 'đang hoạt động',
    })),
  };
}

async function toolListStudents(args: { class_name?: string }) {
  if (args.class_name) {
    const r = await resolveClass(args.class_name);
    if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((c: any) => c.name) };
    const { data } = await supabase
      .from('student_classes')
      .select('is_primary, students ( name, status )')
      .eq('class_id', r.one.id);
    const students = (data || [])
      .filter((sc: any) => sc.students?.status !== 'on_leave')
      .map((sc: any) => sc.students?.name)
      .filter(Boolean);
    return { ten_lop: r.one.name, si_so: students.length, hoc_sinh: students };
  }
  const { data } = await supabase.from('students').select('name').order('name');
  return { tong: (data || []).length, hoc_sinh: (data || []).map((s: any) => s.name) };
}

// Tính nợ học phí — port từ app/page.tsx (charge_fee, lớp khóa, enrolled_at)
async function computeDebts(months: string[], classNameFilter?: string) {
  const { data: rels } = await supabase
    .from('student_classes')
    .select(`enrolled_at, students ( id, name ), classes ( id, name, tuition, status )`)
    .eq('charge_fee', true);

  const { data: pays } = await supabase
    .from('payments')
    .select('student_id, class_id, month, status, amount')
    .in('month', months);

  const paidSet = new Set(
    (pays || []).filter((p: any) => p.status === 'paid')
      .map((p: any) => `${p.student_id}-${p.class_id}-${p.month}`)
  );
  // Số tiền tùy chỉnh cho dòng chưa đóng (em vào giữa tháng...)
  const customAmount = new Map<string, number>();
  (pays || []).filter((p: any) => p.status === 'unpaid')
    .forEach((p: any) => customAmount.set(`${p.student_id}-${p.class_id}-${p.month}`, p.amount));
  // classNameFilter đã được resolveClass chuẩn hóa về đúng 1 tên lớp → so khớp CHÍNH XÁC
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const kw = classNameFilter ? norm(classNameFilter) : '';

  const debts: { name: string; class: string; month: string; amount: number }[] = [];
  for (const month of months) {
    for (const sc of (rels || [])) {
      const cls = (sc as any).classes;
      const st = (sc as any).students;
      if (!cls || !st || cls.status === 'locked') continue;
      if (kw && norm(cls.name) !== kw) continue;
      const enrolledMonth = (sc as any).enrolled_at ? (sc as any).enrolled_at.substring(0, 7) : month;
      if (month < enrolledMonth) continue;
      const key = `${st.id}-${cls.id}-${month}`;
      if (!paidSet.has(key)) {
        debts.push({ name: st.name, class: cls.name, month, amount: customAmount.has(key) ? customAmount.get(key)! : (cls.tuition || 0) });
      }
    }
  }
  return debts;
}

async function toolGetDebts(args: { month?: string; class_name?: string }) {
  // Nếu lọc theo lớp: resolve về đúng 1 lớp, mơ hồ thì hỏi lại
  let classFilter: string | undefined;
  if (args.class_name) {
    const r = await resolveClass(args.class_name);
    if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((c: any) => c.name) };
    classFilter = r.one.name;
  }
  // Nếu không nói tháng: tính lũy kế từ 2026-01 đến tháng hiện tại
  const months = args.month ? [args.month] : monthRange('2026-01', currentMonth());
  const debts = await computeDebts(months, classFilter);
  return {
    so_khoan_no: debts.length,
    tong_tien: debts.reduce((s, d) => s + d.amount, 0),
    danh_sach: debts.map(d => ({ ten: d.name, lop: d.class, thang: d.month, so_tien: d.amount })),
  };
}

async function toolGetPayments(args: { month: string; class_name?: string }) {
  const month = args.month || currentMonth();
  let query = supabase
    .from('payments')
    .select('amount, paid_date, student_id, students ( name ), classes ( name )')
    .eq('status', 'paid')
    .eq('month', month);

  if (args.class_name) {
    const r = await resolveClass(args.class_name);
    if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((c: any) => c.name) };
    query = query.eq('class_id', r.one.id);
  }

  const { data } = await query;
  const list = (data || []).map((p: any) => ({
    ten: p.students?.name,
    lop: p.classes?.name,
    so_tien: p.amount,
    ngay_dong: p.paid_date,
  }));
  return {
    thang: month,
    so_luot: list.length,
    tong_tien: list.reduce((s: number, p: any) => s + (p.so_tien || 0), 0),
    danh_sach: list,
  };
}

async function toolGetRevenue(args: { period: 'month' | 'quarter' | 'year'; value: string }) {
  let months: string[] = [];
  if (args.period === 'month') {
    months = [args.value];
  } else if (args.period === 'quarter') {
    const m = args.value.match(/(\d{4}).*?([1-4])/);
    if (m) {
      const y = m[1];
      const q = Number(m[2]);
      const start = (q - 1) * 3 + 1;
      months = [0, 1, 2].map(i => `${y}-${String(start + i).padStart(2, '0')}`);
    }
  } else {
    const y = args.value.match(/\d{4}/)?.[0] || args.value;
    months = monthRange(`${y}-01`, `${y}-12`);
  }

  const { data } = await supabase
    .from('payments')
    .select('amount, month')
    .eq('status', 'paid')
    .in('month', months);

  const total = (data || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
  // Chi tiết theo tháng
  const byMonth: Record<string, number> = {};
  (data || []).forEach((p: any) => { byMonth[p.month] = (byMonth[p.month] || 0) + (p.amount || 0); });

  return {
    ky: `${args.period} ${args.value}`,
    tong_doanh_thu: total,
    chi_tiet_thang: Object.entries(byMonth).sort().map(([thang, tien]) => ({ thang, tien })),
  };
}

// Danh sách các khoản THỰC THU trong 1 tháng (lọc theo paid_date — khớp tab "Danh sách nộp phí"). Dùng cho báo cáo thuế.
async function toolGetCollections(args: { month: string; class_name?: string }) {
  const month = args.month || currentMonth();
  const [year, mo] = month.split('-');
  const startDate = `${month}-01`;
  const lastDay = new Date(parseInt(year), parseInt(mo), 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  let query = supabase
    .from('payments')
    .select('amount, paid_date, month, students ( name ), classes ( name )')
    .eq('status', 'paid')
    .gte('paid_date', startDate)
    .lte('paid_date', endDate)
    .order('paid_date', { ascending: true });

  if (args.class_name) {
    const r = await resolveClass(args.class_name);
    if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((c: any) => c.name) };
    query = query.eq('class_id', r.one.id);
  }

  const { data } = await query;
  const list = (data || []).map((p: any) => ({
    ten: p.students?.name,
    lop: p.classes?.name,
    so_tien: p.amount,
    ngay_thu: p.paid_date,
    hoc_phi_thang: p.month,
  }));
  return {
    thang_thu: month,
    so_luot: list.length,
    tong_thuc_thu: list.reduce((s: number, p: any) => s + (p.so_tien || 0), 0),
    danh_sach: list,
  };
}

// Tổng số tiền 1 học sinh đã nộp cho trung tâm từ đầu đến giờ (mọi lớp, mọi tháng).
async function toolStudentTotalPaid(args: { name: string }) {
  const kw = (args.name || '').trim().toLowerCase();
  if (!kw) return { found: 0 };
  const { data: students } = await supabase.from('students').select('id, name');
  const matched = (students || []).filter((s: any) => s.name.toLowerCase().includes(kw));
  if (matched.length === 0) return { found: 0 };

  if (matched.length > 1) {
    const ids = matched.map((s: any) => s.id);
    const { data: rels } = await supabase
      .from('student_classes')
      .select('student_id, classes ( name )')
      .in('student_id', ids)
      .eq('is_primary', true);
    return {
      need_clarification: true,
      matches: matched.map((s: any) => ({
        ten: s.name,
        lop: ((rels || []).find((r: any) => r.student_id === s.id) as any)?.classes?.name || '?',
      })),
    };
  }

  const s = matched[0];
  const { data: pays } = await supabase
    .from('payments')
    .select('amount, month, paid_date, classes ( name )')
    .eq('student_id', s.id)
    .eq('status', 'paid')
    .order('month', { ascending: true });

  return {
    ten: s.name,
    so_lan_nop: (pays || []).length,
    tong_da_nop: (pays || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0),
    chi_tiet: (pays || []).map((p: any) => ({ thang: p.month, lop: p.classes?.name, so_tien: p.amount, ngay_thu: p.paid_date })),
  };
}

// Doanh thu theo TỪNG LỚP trong 1 tháng (cộng server-side, khớp trang Thống kê học phí theo lớp).
async function toolRevenueByClass(args: { month: string }) {
  const month = args.month || currentMonth();
  const { data: classes } = await supabase.from('classes').select('id, name').order('name');
  const { data: pays } = await supabase
    .from('payments')
    .select('class_id, amount')
    .eq('status', 'paid')
    .eq('month', month);

  const sumByClass = new Map<string, number>();
  (pays || []).forEach((p: any) => sumByClass.set(p.class_id, (sumByClass.get(p.class_id) || 0) + (p.amount || 0)));

  const list = (classes || [])
    .map((c: any) => ({ lop: c.name, so_tien: sumByClass.get(c.id) || 0 }))
    .filter((x: any) => x.so_tien > 0);

  return { thang: month, danh_sach: list, tong: list.reduce((s: number, x: any) => s + x.so_tien, 0) };
}

async function toolAttendanceSummary(args: { class_name: string; month: string; student_name?: string }) {
  const r = await resolveClass(args.class_name);
  if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((c: any) => c.name) };
  const month = args.month || currentMonth();

  const { data } = await supabase
    .from('attendance')
    .select('student_id, status, date, students ( name )')
    .eq('class_id', r.one.id)
    .gte('date', `${month}-01`)
    .lte('date', `${month}-31`);

  const dates = new Set<string>();
  const per: Record<string, { name: string; hoc: number; vang: number }> = {};
  (data || []).forEach((a: any) => {
    dates.add(a.date);
    const key = a.student_id;
    if (!per[key]) per[key] = { name: a.students?.name || '?', hoc: 0, vang: 0 };
    if (a.status === 'absent') per[key].vang += 1;
    else per[key].hoc += 1; // present/late/excused = có đi học
  });

  let list = Object.values(per);
  if (args.student_name) {
    const kw = args.student_name.trim().toLowerCase();
    list = list.filter(x => x.name.toLowerCase().includes(kw));
  }
  list.sort((a, b) => b.vang - a.vang);

  return {
    lop: r.one.name,
    thang: month,
    tong_buoi_lop_da_hoc: dates.size,
    danh_sach: list.map(x => ({ ten: x.name, so_buoi_di_hoc: x.hoc, so_buoi_vang: x.vang })),
  };
}

// ---- Công cụ GHI: thu phí (Giai đoạn 2) ----

// Tìm học sinh (kèm các lớp có thu phí + trạng thái đóng tháng) để xác định đúng đối tượng trước khi ghi.
async function toolFindStudents(args: { name: string; class_name?: string; month?: string }) {
  const month = args.month || currentMonth();
  const kw = (args.name || '').trim().toLowerCase();
  if (!kw) return { found: 0 };
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

  const { data: rels } = await supabase
    .from('student_classes')
    .select('charge_fee, students ( id, name, status ), classes ( id, name, tuition, status )')
    .eq('charge_fee', true);

  let list = (rels || []).filter((r: any) =>
    r.students && r.classes &&
    r.students.name.toLowerCase().includes(kw) &&
    r.classes.status !== 'locked' &&
    r.students.status !== 'on_leave'
  );
  if (args.class_name) {
    const cn = norm(args.class_name);
    const exact = list.filter((r: any) => norm(r.classes.name) === cn);
    list = exact.length ? exact : list.filter((r: any) => norm(r.classes.name).includes(cn));
  }
  if (list.length === 0) return { found: 0, month };

  const studentIds = [...new Set(list.map((r: any) => r.students.id))];
  const { data: pays } = await supabase
    .from('payments')
    .select('student_id, class_id, status, amount')
    .eq('month', month)
    .in('student_id', studentIds);
  const payMap = new Map<string, any>();
  (pays || []).forEach((p: any) => payMap.set(`${p.student_id}-${p.class_id}`, p));

  return {
    month,
    matches: list.map((r: any) => {
      const p = payMap.get(`${r.students.id}-${r.classes.id}`);
      return {
        student_id: r.students.id,
        ten: r.students.name,
        class_id: r.classes.id,
        lop: r.classes.name,
        hoc_phi_lop: r.classes.tuition,
        trang_thai_thang: p?.status === 'paid' ? 'đã đóng' : 'chưa đóng',
        so_tien_hien_tai: p?.amount ?? r.classes.tuition,
      };
    }),
  };
}

// Ghi "đã đóng" cho 1 học sinh ở 1 lớp trong 1 tháng. CHỈ gọi sau khi người dùng đã xác nhận.
async function toolMarkPaid(args: { student_id: string; class_id: string; month?: string; amount?: number; note?: string }) {
  const month = args.month || currentMonth();
  if (!args.student_id || !args.class_id) return { ok: false, error: 'thiếu student_id hoặc class_id — hãy dùng find_students trước' };

  const { data: cls } = await supabase.from('classes').select('name, tuition').eq('id', args.class_id).maybeSingle();
  if (!cls) return { ok: false, error: 'class_id không tồn tại — hãy dùng find_students để lấy đúng id' };

  const { data: existing } = await supabase
    .from('payments')
    .select('id, amount')
    .eq('student_id', args.student_id)
    .eq('class_id', args.class_id)
    .eq('month', month)
    .maybeSingle();

  // Số tiền mặc định = số đang nợ của tháng đó (dòng unpaid tùy chỉnh nếu có), không thì học phí lớp
  const amount = typeof args.amount === 'number' ? args.amount : (existing?.amount ?? cls.tuition ?? 0);

  let writeErr: any = null;
  if (existing) {
    const { error } = await supabase.from('payments').update({
      status: 'paid', amount, paid_date: todayStr(), note: args.note ?? null,
    }).eq('id', existing.id);
    writeErr = error;
  } else {
    const { error } = await supabase.from('payments').insert([{
      student_id: args.student_id, class_id: args.class_id, month,
      amount, sessions: 0, paid_date: todayStr(), status: 'paid', note: args.note ?? null,
    }]);
    writeErr = error;
  }
  if (writeErr) return { ok: false, error: writeErr.message || String(writeErr) };

  const { data: st } = await supabase.from('students').select('name').eq('id', args.student_id).maybeSingle();
  return { ok: true, ten: st?.name, lop: cls.name, thang: month, so_tien: amount, ngay_dong: todayStr(), ghi_chu: args.note ?? null };
}

// ---- Công cụ điểm danh (Giai đoạn 3) ----

// Lấy danh sách học sinh 1 lớp kèm trạng thái điểm danh của 1 ngày (để xác định đúng em vắng trước khi ghi).
async function toolGetRoster(args: { class_name: string; date?: string }) {
  const r = await resolveClass(args.class_name);
  if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((c: any) => c.name) };
  const date = args.date || todayStr();

  const { data: rels } = await supabase
    .from('student_classes')
    .select('students ( id, name, status )')
    .eq('class_id', r.one.id);
  const students = (rels || []).map((x: any) => x.students).filter((s: any) => s && s.status !== 'on_leave');

  const { data: existing } = await supabase
    .from('attendance')
    .select('student_id, status')
    .eq('class_id', r.one.id)
    .eq('date', date);
  const stMap = new Map((existing || []).map((a: any) => [a.student_id, a.status]));

  return {
    class_id: r.one.id,
    lop: r.one.name,
    ngay: date,
    si_so: students.length,
    hoc_sinh: students.map((s: any) => ({
      student_id: s.id,
      ten: s.name,
      trang_thai: stMap.get(s.id) === 'absent' ? 'vắng' : stMap.get(s.id) === 'present' ? 'có mặt' : 'chưa điểm danh',
    })),
  };
}

// Lưu điểm danh: các em trong absent_student_ids = vắng, còn lại = có mặt, cho 1 ngày. CHỈ gọi sau khi xác nhận.
async function toolSaveAttendance(args: { class_id: string; date?: string; absent_student_ids?: string[] }) {
  const date = args.date || todayStr();
  if (!args.class_id) return { error: 'thiếu class_id — hãy dùng get_class_roster trước' };
  const absentSet = new Set(args.absent_student_ids || []);

  const { data: rels } = await supabase
    .from('student_classes')
    .select('students ( id, name, status )')
    .eq('class_id', args.class_id);
  const students = (rels || []).map((x: any) => x.students).filter((s: any) => s && s.status !== 'on_leave');
  if (students.length === 0) return { error: 'lớp không có học sinh' };

  const { data: existing } = await supabase
    .from('attendance')
    .select('id, student_id')
    .eq('class_id', args.class_id)
    .eq('date', date);
  const existMap = new Map((existing || []).map((a: any) => [a.student_id, a.id]));

  const absentNames: string[] = [];
  let writeErr: any = null;
  for (const st of students) {
    const status = absentSet.has(st.id) ? 'absent' : 'present';
    if (status === 'absent') absentNames.push(st.name);
    const eid = existMap.get(st.id);
    if (eid) {
      const { error } = await supabase.from('attendance').update({ status }).eq('id', eid);
      if (error) writeErr = error;
    } else {
      const { error } = await supabase.from('attendance').insert([{ student_id: st.id, class_id: args.class_id, date, status, note: '' }]);
      if (error) writeErr = error;
    }
  }
  if (writeErr) return { ok: false, error: writeErr.message || String(writeErr) };

  const { data: cls } = await supabase.from('classes').select('name').eq('id', args.class_id).maybeSingle();
  return { ok: true, lop: cls?.name, ngay: date, si_so: students.length, so_vang: absentNames.length, vang: absentNames };
}

// ---- Công cụ quản lý học sinh (Giai đoạn 4) ----

// Tìm học sinh kèm tất cả lớp (chính/phụ + có thu phí không). Dùng để chuyển lớp / xem thông tin.
async function toolGetStudentClasses(args: { name: string }) {
  const kw = (args.name || '').trim().toLowerCase();
  if (!kw) return { found: 0 };
  const { data: students } = await supabase.from('students').select('id, name, status');
  const matched = (students || []).filter((s: any) => s.name.toLowerCase().includes(kw));
  if (matched.length === 0) return { found: 0 };

  const ids = matched.map((s: any) => s.id);
  const { data: rels } = await supabase
    .from('student_classes')
    .select('student_id, is_primary, charge_fee, classes ( id, name )')
    .in('student_id', ids);

  return {
    matches: matched.map((s: any) => ({
      student_id: s.id,
      ten: s.name,
      trang_thai: s.status === 'on_leave' ? 'tạm nghỉ' : 'đang học',
      lop: (rels || []).filter((r: any) => r.student_id === s.id).map((r: any) => ({
        class_id: r.classes?.id,
        ten_lop: r.classes?.name,
        loai: r.is_primary ? 'chính' : 'phụ',
        thu_phi: r.charge_fee,
      })),
    })),
  };
}

// Thêm học sinh mới + lớp chính (luôn thu phí) + lớp phụ (mỗi lớp có/không thu phí). CHỈ gọi sau xác nhận.
async function toolAddStudent(args: {
  name: string; primary_class: string;
  secondary_classes?: { name: string; charge_fee?: boolean }[];
  phone?: string; parent_phone?: string; note?: string; allow_duplicate?: boolean;
}) {
  if (!args.name?.trim()) return { ok: false, error: 'thiếu tên học sinh' };
  if (!args.primary_class?.trim()) return { ok: false, error: 'thiếu lớp chính' };

  const pr = await resolveClass(args.primary_class);
  if (!pr.one) return { ok: false, need_clarification: true, field: 'lớp chính', matches: (pr.matches || []).map((c: any) => c.name) };

  // Chặn trùng: đã có em CÙNG TÊN trong lớp chính này chưa?
  const nameNorm = args.name.trim().toLowerCase().replace(/\s+/g, ' ');
  const { data: clsRels } = await supabase
    .from('student_classes')
    .select('students ( name )')
    .eq('class_id', pr.one.id);
  const trung = (clsRels || []).some((r: any) =>
    (r.students?.name || '').trim().toLowerCase().replace(/\s+/g, ' ') === nameNorm);
  if (trung && !args.allow_duplicate) {
    return {
      ok: false,
      duplicate: true,
      message: `Đã có học sinh tên "${args.name.trim()}" trong lớp ${pr.one.name}. Nếu bạn muốn thêm MỘT EM KHÁC cùng tên thì nên đặt tên khác để phân biệt (vd thêm biệt danh), rồi xác nhận lại.`,
    };
  }

  const secResolved: { id: string; name: string; charge_fee: boolean }[] = [];
  for (const sc of (args.secondary_classes || [])) {
    const r = await resolveClass(sc.name);
    if (!r.one) return { ok: false, need_clarification: true, field: `lớp phụ "${sc.name}"`, matches: (r.matches || []).map((c: any) => c.name) };
    secResolved.push({ id: r.one.id, name: r.one.name, charge_fee: !!sc.charge_fee });
  }

  const { data: newStudent, error: insErr } = await supabase.from('students').insert([{
    name: args.name.trim(), phone: args.phone || '', parent_phone: args.parent_phone || '', note: args.note || '',
  }]).select().single();
  if (insErr || !newStudent) return { ok: false, error: insErr?.message || 'không tạo được học sinh' };

  const now = new Date().toISOString();
  const rels = [
    { student_id: newStudent.id, class_id: pr.one.id, is_primary: true, charge_fee: true, enrolled_at: now },
    ...secResolved.map(s => ({ student_id: newStudent.id, class_id: s.id, is_primary: false, charge_fee: s.charge_fee, enrolled_at: now })),
  ];
  const { error: relErr } = await supabase.from('student_classes').insert(rels);
  if (relErr) return { ok: false, error: relErr.message };

  return { ok: true, ten: newStudent.name, lop_chinh: pr.one.name, lop_phu: secResolved.map(s => ({ ten: s.name, thu_phi: s.charge_fee })) };
}

// Chuyển lớp chính + dời điểm danh và học phí sang lớp mới. CHỈ gọi sau xác nhận.
async function toolTransferStudent(args: { student_id: string; to_class: string }) {
  if (!args.student_id) return { ok: false, error: 'thiếu student_id — hãy dùng get_student_classes trước' };
  const to = await resolveClass(args.to_class);
  if (!to.one) return { ok: false, need_clarification: true, matches: (to.matches || []).map((c: any) => c.name) };

  const { data: prim } = await supabase.from('student_classes')
    .select('id, class_id').eq('student_id', args.student_id).eq('is_primary', true).maybeSingle();
  if (!prim) return { ok: false, error: 'học sinh chưa có lớp chính' };
  const oldClassId = prim.class_id;
  if (oldClassId === to.one.id) return { ok: false, error: 'học sinh đã ở lớp này rồi' };

  // Tránh trùng: nếu em đã có quan hệ với lớp đích (đang là lớp phụ) thì báo để xử lý trong app
  const { data: dup } = await supabase.from('student_classes')
    .select('id').eq('student_id', args.student_id).eq('class_id', to.one.id).maybeSingle();
  if (dup) return { ok: false, error: 'em đã học lớp đích này (dạng lớp phụ) — hãy chỉnh trong app để tránh trùng' };

  const { error: e1 } = await supabase.from('student_classes').update({ class_id: to.one.id }).eq('id', prim.id);
  if (e1) return { ok: false, error: e1.message };

  const { error: e2 } = await supabase.from('attendance').update({ class_id: to.one.id }).eq('student_id', args.student_id).eq('class_id', oldClassId);
  const { error: e3 } = await supabase.from('payments').update({ class_id: to.one.id }).eq('student_id', args.student_id).eq('class_id', oldClassId);
  if (e2 || e3) return { ok: false, error: (e2 || e3)?.message, luu_y: 'lớp đã đổi nhưng dời điểm danh/học phí có thể chưa trọn — kiểm tra lại' };

  const { data: st } = await supabase.from('students').select('name').eq('id', args.student_id).maybeSingle();
  const { data: oldCls } = await supabase.from('classes').select('name').eq('id', oldClassId).maybeSingle();
  return { ok: true, ten: st?.name, tu_lop: oldCls?.name, sang_lop: to.one.name, da_chuyen: 'điểm danh + học phí' };
}

// Đổi tên (thông tin) học sinh. CHỈ gọi sau xác nhận.
async function toolRenameStudent(args: { student_id: string; new_name: string }) {
  if (!args.student_id || !args.new_name?.trim()) return { ok: false, error: 'thiếu student_id hoặc tên mới — dùng get_student_classes để lấy id' };
  const { error } = await supabase.from('students').update({ name: args.new_name.trim() }).eq('id', args.student_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, ten_moi: args.new_name.trim() };
}

// ---- Công cụ TRỢ GIẢNG (Giai đoạn 5) ----

async function resolveAssistant(name: string) {
  const { data } = await supabase.from('assistants').select('id, name');
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const kw = norm(name);
  const exact = (data || []).filter((a: any) => norm(a.name) === kw);
  if (exact.length === 1) return { one: exact[0] as any };
  const partial = (data || []).filter((a: any) => norm(a.name).includes(kw));
  if (partial.length === 1) return { one: partial[0] as any };
  return { matches: partial as any[] };
}

// Tìm trợ giảng + các lớp phụ trách (kèm id). Dùng trước khi điểm danh trợ giảng.
async function toolFindAssistant(args: { name: string }) {
  const r = await resolveAssistant(args.name);
  if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((a: any) => a.name) };
  const { data: acs } = await supabase
    .from('assistant_classes')
    .select('class_id, classes ( name )')
    .eq('assistant_id', r.one.id);
  return {
    assistant_id: r.one.id,
    ten: r.one.name,
    lop_phu_trach: (acs || []).map((x: any) => ({ class_id: x.class_id, ten_lop: x.classes?.name })),
  };
}

// Tạo trợ giảng mới + (tùy chọn) phân công lớp. CHỈ gọi sau xác nhận.
async function toolAddAssistant(args: { name: string; phone?: string; note?: string; class_names?: string[] }) {
  if (!args.name?.trim()) return { ok: false, error: 'thiếu tên trợ giảng' };
  const classIds: { id: string; name: string }[] = [];
  for (const cn of (args.class_names || [])) {
    const r = await resolveClass(cn);
    if (!r.one) return { ok: false, need_clarification: true, field: `lớp "${cn}"`, matches: (r.matches || []).map((c: any) => c.name) };
    classIds.push({ id: r.one.id, name: r.one.name });
  }
  const { data: na, error } = await supabase.from('assistants')
    .insert({ name: args.name.trim(), phone: args.phone || null, note: args.note || null })
    .select().single();
  if (error || !na) return { ok: false, error: error?.message || 'không tạo được trợ giảng' };
  if (classIds.length) {
    const { error: e2 } = await supabase.from('assistant_classes')
      .insert(classIds.map(c => ({ assistant_id: na.id, class_id: c.id })));
    if (e2) return { ok: false, error: e2.message };
  }
  return { ok: true, ten: na.name, lop_phu_trach: classIds.map(c => c.name) };
}

// Điểm danh trợ giảng: đánh dấu trợ giảng đã dạy các lớp trong 1 ngày (mỗi lớp = 1 buổi). CHỈ gọi sau xác nhận.
async function toolMarkAssistantTaught(args: { assistant_id: string; class_ids: string[]; date?: string }) {
  const date = args.date || todayStr();
  if (!args.assistant_id || !Array.isArray(args.class_ids) || args.class_ids.length === 0)
    return { ok: false, error: 'thiếu assistant_id hoặc class_ids — dùng find_assistant trước' };

  let werr: any = null;
  const doneNames: string[] = [];
  for (const cid of args.class_ids) {
    const { data: ex } = await supabase.from('assistant_sessions').select('id')
      .eq('assistant_id', args.assistant_id).eq('class_id', cid).eq('date', date).maybeSingle();
    if (ex) continue; // đã điểm danh
    const { error } = await supabase.from('assistant_sessions')
      .insert({ assistant_id: args.assistant_id, class_id: cid, date, sessions_count: 1, note: '' });
    if (error) werr = error;
    else {
      const { data: c } = await supabase.from('classes').select('name').eq('id', cid).maybeSingle();
      doneNames.push(c?.name || cid);
    }
  }
  if (werr) return { ok: false, error: werr.message };
  const { data: a } = await supabase.from('assistants').select('name').eq('id', args.assistant_id).maybeSingle();
  return { ok: true, ten: a?.name, ngay: date, so_buoi: doneNames.length, cac_lop: doneNames };
}

// Thống kê số buổi dạy của trợ giảng theo tháng (tổng theo từng trợ giảng + lớp).
async function toolGetAssistantSessions(args: { month: string; assistant_name?: string }) {
  const month = args.month || currentMonth();
  const [y, mo] = month.split('-');
  const start = `${month}-01`;
  const lastDay = new Date(parseInt(y), parseInt(mo), 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  const { data } = await supabase
    .from('assistant_sessions')
    .select('assistant_id, sessions_count, assistants ( name ), classes ( name )')
    .gte('date', start).lte('date', end);

  let rows = (data || []) as any[];
  if (args.assistant_name) {
    const r = await resolveAssistant(args.assistant_name);
    if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((a: any) => a.name) };
    const aid = r.one.id;
    rows = rows.filter((x: any) => x.assistant_id === aid);
  }

  const g: Record<string, { ten: string; lop: string; so: number }> = {};
  rows.forEach((x: any) => {
    const key = `${x.assistant_id}-${x.classes?.name}`;
    if (!g[key]) g[key] = { ten: x.assistants?.name || '?', lop: x.classes?.name || '?', so: 0 };
    g[key].so += x.sessions_count;
  });
  const list = Object.values(g);
  return {
    thang: month,
    danh_sach: list.map(v => ({ tro_giang: v.ten, lop: v.lop, so_buoi: v.so })),
    tong_buoi: list.reduce((s, v) => s + v.so, 0),
  };
}

// Bảng điều phối tên công cụ → hàm
async function runTool(name: string, args: any): Promise<unknown> {
  switch (name) {
    case 'list_classes': return toolListClasses();
    case 'list_students': return toolListStudents(args);
    case 'get_debts': return toolGetDebts(args);
    case 'get_payments': return toolGetPayments(args);
    case 'get_revenue': return toolGetRevenue(args);
    case 'get_revenue_by_class': return toolRevenueByClass(args);
    case 'get_collections': return toolGetCollections(args);
    case 'get_student_total_paid': return toolStudentTotalPaid(args);
    case 'get_attendance_summary': return toolAttendanceSummary(args);
    case 'find_students': return toolFindStudents(args);
    case 'mark_paid': return toolMarkPaid(args);
    case 'get_class_roster': return toolGetRoster(args);
    case 'save_attendance': return toolSaveAttendance(args);
    case 'get_student_classes': return toolGetStudentClasses(args);
    case 'add_student': return toolAddStudent(args);
    case 'transfer_student': return toolTransferStudent(args);
    case 'rename_student': return toolRenameStudent(args);
    case 'find_assistant': return toolFindAssistant(args);
    case 'add_assistant': return toolAddAssistant(args);
    case 'mark_assistant_taught': return toolMarkAssistantTaught(args);
    case 'get_assistant_sessions': return toolGetAssistantSessions(args);
    default: return { error: `unknown_tool: ${name}` };
  }
}

// ==================== KHAI BÁO CÔNG CỤ CHO GEMINI ====================

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'list_classes',
      description: 'Liệt kê tất cả lớp học kèm môn, học phí, trạng thái (đang hoạt động/đã khóa).',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'list_students',
      description: 'Liệt kê học sinh. Nếu có class_name thì chỉ lấy học sinh của lớp đó, kèm sĩ số.',
      parameters: {
        type: 'object',
        properties: { class_name: { type: 'string', description: 'Tên lớp (tùy chọn), khớp một phần được' } },
      },
    },
    {
      name: 'get_debts',
      description: 'Danh sách học sinh còn NỢ học phí. month dạng YYYY-MM; nếu bỏ trống sẽ tính lũy kế mọi tháng tới hiện tại. class_name để lọc theo lớp (tùy chọn).',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Tháng cần kiểm tra, dạng YYYY-MM. Bỏ trống = lũy kế.' },
          class_name: { type: 'string', description: 'Tên lớp (tùy chọn)' },
        },
      },
    },
    {
      name: 'get_payments',
      description: 'Danh sách học sinh ĐÃ nộp phí trong 1 tháng. month bắt buộc dạng YYYY-MM. class_name lọc theo lớp (tùy chọn).',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Tháng, dạng YYYY-MM' },
          class_name: { type: 'string', description: 'Tên lớp (tùy chọn)' },
        },
        required: ['month'],
      },
    },
    {
      name: 'get_revenue',
      description: 'Tổng doanh thu (tiền đã thu) theo tháng/quý/năm.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['month', 'quarter', 'year'], description: 'Loại kỳ' },
          value: { type: 'string', description: 'Tháng YYYY-MM, quý YYYY-Q2, hoặc năm YYYY' },
        },
        required: ['period', 'value'],
      },
    },
    {
      name: 'get_revenue_by_class',
      description: 'Doanh thu của TỪNG LỚP trong 1 tháng, tính theo THÁNG HỌC PHÍ (không kể ngày thu). Dùng khi hỏi "doanh thu từng lớp tháng X". KHÔNG tự cộng tay từ get_payments.',
      parameters: {
        type: 'object',
        properties: { month: { type: 'string', description: 'Tháng học phí, dạng YYYY-MM' } },
        required: ['month'],
      },
    },
    {
      name: 'get_collections',
      description: 'Danh sách các khoản THỰC THU trong 1 tháng, lọc theo NGÀY THU thực tế (paid_date) — dùng cho BÁO CÁO THUẾ ("tháng X thu được bao nhiêu/những khoản nào"). Khác get_revenue_by_class (theo tháng học phí).',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Tháng thu tiền, dạng YYYY-MM' },
          class_name: { type: 'string', description: 'Lọc theo lớp (tùy chọn)' },
        },
        required: ['month'],
      },
    },
    {
      name: 'get_student_total_paid',
      description: 'Tổng số tiền MỘT học sinh đã nộp cho trung tâm từ trước đến nay (mọi lớp, mọi tháng), kèm chi tiết từng lần.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Tên (một phần) học sinh' } },
        required: ['name'],
      },
    },
    {
      name: 'get_attendance_summary',
      description: 'Thống kê điểm danh 1 lớp theo tháng: số buổi ĐI HỌC và số buổi VẮNG của từng học sinh, kèm tổng số buổi lớp đã học. student_name để xem 1 em cụ thể (tùy chọn).',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string', description: 'Tên lớp' },
          month: { type: 'string', description: 'Tháng, dạng YYYY-MM' },
          student_name: { type: 'string', description: 'Tên học sinh để lọc 1 em (tùy chọn)' },
        },
        required: ['class_name'],
      },
    },
    {
      name: 'find_students',
      description: 'Tìm học sinh theo tên (kèm các lớp có thu phí, học phí lớp, và trạng thái đóng của tháng). DÙNG TRƯỚC khi thu phí để xác định đúng em và đúng lớp.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tên (một phần) của học sinh' },
          class_name: { type: 'string', description: 'Tên lớp để thu hẹp (tùy chọn)' },
          month: { type: 'string', description: 'Tháng cần xem trạng thái, dạng YYYY-MM (mặc định tháng hiện tại)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'mark_paid',
      description: 'Đánh dấu học sinh ĐÃ ĐÓNG học phí. CHỈ gọi SAU KHI người dùng đã xác nhận. student_id và class_id phải lấy từ find_students.',
      parameters: {
        type: 'object',
        properties: {
          student_id: { type: 'string', description: 'ID học sinh (từ find_students)' },
          class_id: { type: 'string', description: 'ID lớp (từ find_students)' },
          month: { type: 'string', description: 'Tháng đóng, dạng YYYY-MM (mặc định tháng hiện tại)' },
          amount: { type: 'number', description: 'Số tiền. Bỏ trống = học phí lớp.' },
          note: { type: 'string', description: 'Ghi chú (tùy chọn)' },
        },
        required: ['student_id', 'class_id'],
      },
    },
    {
      name: 'get_class_roster',
      description: 'Lấy danh sách học sinh 1 lớp kèm trạng thái điểm danh của 1 ngày. DÙNG TRƯỚC khi điểm danh để lấy student_id các em và xác định đúng em vắng.',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string', description: 'Tên lớp' },
          date: { type: 'string', description: 'Ngày, dạng YYYY-MM-DD (mặc định hôm nay)' },
        },
        required: ['class_name'],
      },
    },
    {
      name: 'save_attendance',
      description: 'Lưu điểm danh 1 buổi: các em trong absent_student_ids = VẮNG, tất cả em còn lại trong lớp = CÓ MẶT. CHỈ gọi SAU KHI người dùng đã xác nhận. class_id và student_id lấy từ get_class_roster.',
      parameters: {
        type: 'object',
        properties: {
          class_id: { type: 'string', description: 'ID lớp (từ get_class_roster)' },
          date: { type: 'string', description: 'Ngày, dạng YYYY-MM-DD (mặc định hôm nay)' },
          absent_student_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Danh sách student_id các em VẮNG. Rỗng nếu cả lớp đi học đủ.',
          },
        },
        required: ['class_id', 'absent_student_ids'],
      },
    },
    {
      name: 'get_student_classes',
      description: 'Tìm học sinh theo tên, trả về các lớp em đang học (chính/phụ, có thu phí không) kèm student_id và class_id. DÙNG TRƯỚC khi chuyển lớp.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Tên (một phần) học sinh' } },
        required: ['name'],
      },
    },
    {
      name: 'add_student',
      description: 'Thêm học sinh mới với lớp chính (luôn thu phí) và tùy chọn các lớp phụ (mỗi lớp phụ có/không thu phí). CHỈ gọi SAU KHI người dùng đã xác nhận.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Họ tên học sinh' },
          primary_class: { type: 'string', description: 'Tên lớp chính' },
          secondary_classes: {
            type: 'array',
            description: 'Các lớp phụ (tùy chọn)',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Tên lớp phụ' },
                charge_fee: { type: 'boolean', description: 'Có thu học phí lớp này không' },
              },
              required: ['name', 'charge_fee'],
            },
          },
          phone: { type: 'string', description: 'SĐT học sinh (tùy chọn)' },
          parent_phone: { type: 'string', description: 'SĐT phụ huynh (tùy chọn)' },
          note: { type: 'string', description: 'Ghi chú (tùy chọn)' },
          allow_duplicate: { type: 'boolean', description: 'Chỉ đặt true khi người dùng đã biết có em trùng tên trong lớp và vẫn muốn thêm một em KHÁC.' },
        },
        required: ['name', 'primary_class'],
      },
    },
    {
      name: 'transfer_student',
      description: 'Chuyển lớp CHÍNH của học sinh sang lớp mới, dời toàn bộ điểm danh và học phí theo. CHỈ gọi SAU KHI người dùng đã xác nhận. student_id lấy từ get_student_classes.',
      parameters: {
        type: 'object',
        properties: {
          student_id: { type: 'string', description: 'ID học sinh (từ get_student_classes)' },
          to_class: { type: 'string', description: 'Tên lớp đích' },
        },
        required: ['student_id', 'to_class'],
      },
    },
    {
      name: 'rename_student',
      description: 'Sửa TÊN học sinh. CHỈ gọi SAU KHI người dùng đã xác nhận. student_id lấy từ get_student_classes.',
      parameters: {
        type: 'object',
        properties: {
          student_id: { type: 'string', description: 'ID học sinh (từ get_student_classes)' },
          new_name: { type: 'string', description: 'Tên mới' },
        },
        required: ['student_id', 'new_name'],
      },
    },
    {
      name: 'find_assistant',
      description: 'Tìm trợ giảng theo tên, trả về assistant_id và các lớp phụ trách (kèm class_id). DÙNG TRƯỚC khi điểm danh trợ giảng.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Tên (một phần) trợ giảng' } },
        required: ['name'],
      },
    },
    {
      name: 'add_assistant',
      description: 'Tạo trợ giảng mới, tùy chọn phân công các lớp phụ trách. CHỈ gọi SAU KHI người dùng đã xác nhận.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Họ tên trợ giảng' },
          phone: { type: 'string', description: 'SĐT (tùy chọn)' },
          note: { type: 'string', description: 'Ghi chú (tùy chọn)' },
          class_names: { type: 'array', items: { type: 'string' }, description: 'Tên các lớp phụ trách (tùy chọn)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'mark_assistant_taught',
      description: 'Điểm danh trợ giảng: đánh dấu trợ giảng đã dạy các lớp trong 1 ngày (mỗi lớp = 1 buổi). CHỈ gọi SAU KHI người dùng đã xác nhận. assistant_id và class_id lấy từ find_assistant.',
      parameters: {
        type: 'object',
        properties: {
          assistant_id: { type: 'string', description: 'ID trợ giảng (từ find_assistant)' },
          class_ids: { type: 'array', items: { type: 'string' }, description: 'Danh sách class_id các lớp đã dạy hôm đó' },
          date: { type: 'string', description: 'Ngày, dạng YYYY-MM-DD (mặc định hôm nay)' },
        },
        required: ['assistant_id', 'class_ids'],
      },
    },
    {
      name: 'get_assistant_sessions',
      description: 'Thống kê số buổi dạy của trợ giảng trong 1 tháng (tổng theo từng trợ giảng và lớp). assistant_name để lọc 1 trợ giảng (tùy chọn).',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Tháng, dạng YYYY-MM' },
          assistant_name: { type: 'string', description: 'Tên trợ giảng để lọc (tùy chọn)' },
        },
        required: ['month'],
      },
    },
  ],
}];

function systemPrompt(): string {
  return `Bạn là trợ lý tra cứu cho ứng dụng "Quản lý Lớp học" (điểm danh & học phí). Chỉ có MỘT người dùng là chủ trung tâm.

Hôm nay là ${todayStr()} (tháng hiện tại: ${currentMonth()}).

NHIỆM VỤ: Người dùng hỏi về dữ liệu lớp học (nợ học phí, ai đã nộp, doanh thu, sĩ số, điểm danh...) HOẶC ra lệnh THU HỌC PHÍ / ĐIỂM DANH. Bạn GỌI CÔNG CỤ phù hợp để lấy/ghi dữ liệu THẬT. TUYỆT ĐỐI không bịa số liệu — luôn dựa vào kết quả công cụ.

BÁO KẾT QUẢ TRUNG THỰC: Sau khi gọi công cụ ghi (mark_paid, save_attendance), CHỈ báo "đã xong" nếu kết quả trả về có ok=true. Nếu ok=false hoặc có error, phải nói RÕ là CHƯA ghi được và nêu lý do — TUYỆT ĐỐI không tự nhận đã đóng/đã lưu khi công cụ báo lỗi. Khi ghi nhiều em cùng lúc, chỉ liệt kê "đã đóng/đã lưu" những em có ok=true.

BẠN LÀM ĐƯỢC:
- Tra cứu (đọc): nợ, đã nộp, doanh thu, sĩ số, thống kê vắng...
- THU HỌC PHÍ (ghi): đánh dấu học sinh đã đóng.
- ĐIỂM DANH (ghi): đánh dấu buổi học ai vắng.
- THÊM HỌC SINH (ghi): tạo học sinh mới + lớp chính/phụ.
- CHUYỂN LỚP (ghi): đổi lớp chính, dời điểm danh + học phí theo.
- SỬA TÊN HỌC SINH (ghi): đổi tên một học sinh.
- TRỢ GIẢNG: tạo trợ giảng, điểm danh trợ giảng (dạy lớp nào ngày nào), thống kê số buổi dạy theo tháng.
Xóa học sinh và tạo/sửa/xóa LỚP thì CHƯA làm được — lịch sự nói đang phát triển.

QUY TRÌNH THU HỌC PHÍ (bắt buộc theo đúng thứ tự, RẤT QUAN TRỌNG):
1. Gọi find_students để tìm đúng em. LUÔN truyền tham số month ĐÚNG bằng tháng người dùng muốn thu (vd người dùng nói "tháng 6" → month="2026-06"; không nói tháng → tháng hiện tại). Truyền sai tháng sẽ ra số tiền sai.
2. Nếu KHÔNG tìm thấy → báo người dùng. Nếu có NHIỀU em trùng tên → liệt kê cho người dùng chọn. Nếu em thuộc NHIỀU lớp thu phí mà chưa rõ lớp nào → hỏi lớp nào.
3. Nếu em đó ở tháng này ĐÃ đóng rồi → báo cho người dùng biết, hỏi có muốn ghi đè không.
4. SỐ TIỀN: dùng ĐÚNG "so_tien_hien_tai" mà find_students trả về cho từng em (đây là số em đang NỢ tháng đó, có thể mỗi em một khác). KHÔNG tự lấy học phí lớp cho tất cả. Chỉ đổi khi người dùng nói số khác (vd "đóng 300k").
5. TÓM TẮT rõ trước khi ghi: "Xác nhận: [Tên] — [Lớp] — T[tháng]/[năm] — [số tiền]đ[ — ghi chú nếu có] → đánh dấu ĐÃ ĐÓNG. OK chứ?" rồi DỪNG LẠI chờ người dùng đồng ý.
6. CHỈ gọi mark_paid SAU KHI người dùng xác nhận (ok/đúng/ừ/đồng ý...). TUYỆT ĐỐI không gọi mark_paid ở lượt chưa có xác nhận. Truyền đúng month và amount đã chốt cho từng em.
7. Ghi xong báo lại ngắn gọn kết quả thật từ công cụ.

QUY TRÌNH ĐIỂM DANH (bắt buộc theo đúng thứ tự):
1. Gọi get_class_roster (theo tên lớp + ngày) để lấy danh sách học sinh và student_id.
2. Xác định các em VẮNG theo tên người dùng nói, map sang student_id trong roster. Nếu một tên KHÔNG có trong lớp hoặc mơ hồ (nhiều em trùng) → hỏi lại, đừng đoán bừa.
3. Mặc định ngày = HÔM NAY, trừ khi người dùng nói ngày khác.
4. TÓM TẮT trước khi ghi: "Điểm danh [Lớp] ngày [d/m]: VẮNG [tên các em] ([n] em); còn lại [si_so - n] em có mặt. OK chứ?" rồi DỪNG chờ đồng ý.
5. CHỈ gọi save_attendance SAU KHI người dùng xác nhận. Truyền absent_student_ids là student_id các em vắng (rỗng nếu cả lớp đi đủ).
6. Ghi xong báo lại ngắn gọn: lớp, ngày, số em vắng (kèm tên), số em có mặt.

QUY TRÌNH THÊM HỌC SINH:
1. Cần TÊN (bắt buộc) và LỚP CHÍNH (bắt buộc). Lớp chính LUÔN thu phí.
2. KIỂM TRA TRÙNG TRƯỚC: gọi get_student_classes theo tên. Nếu đã có em CÙNG TÊN đang học ở LỚP CHÍNH định thêm → ĐỪNG thêm, mà nói: "[Tên] đã có trong lớp [X] rồi. Có phải bạn muốn thêm MỘT EM KHÁC cùng tên? Nếu vậy nên đặt tên khác để phân biệt." rồi chờ người dùng làm rõ.
3. Nếu người dùng nói có LỚP PHỤ: với MỖI lớp phụ phải biết CÓ thu phí hay KHÔNG. Chưa rõ → HỎI lại (ảnh hưởng học phí).
4. SĐT, SĐT phụ huynh, ghi chú là tùy chọn.
5. TÓM TẮT: "Thêm [tên] — lớp chính [X] — lớp phụ [Y (thu phí), Z (không thu phí)]... OK?" rồi chờ xác nhận.
6. CHỈ gọi add_student SAU KHI người dùng xác nhận. Chỉ đặt allow_duplicate=true nếu người dùng đã biết trùng tên và vẫn muốn thêm em khác.

QUY TRÌNH CHUYỂN LỚP:
1. Gọi get_student_classes để tìm đúng em + lớp chính hiện tại. Trùng tên → hỏi người dùng chọn.
2. Xác định lớp đích. TÓM TẮT: "Chuyển [tên] từ lớp [cũ] sang lớp [mới]. Toàn bộ điểm danh + học phí sẽ chuyển theo. OK?" rồi chờ xác nhận.
3. CHỈ gọi transfer_student (student_id + to_class) SAU KHI người dùng xác nhận.

QUY TRÌNH SỬA TÊN HỌC SINH:
1. Gọi get_student_classes để tìm đúng em (trùng tên → hỏi chọn).
2. TÓM TẮT: "Đổi tên [tên cũ] → [tên mới]. OK?" rồi chờ xác nhận. CHỈ gọi rename_student sau khi đồng ý.

QUY TRÌNH TRỢ GIẢNG:
- TẠO TRỢ GIẢNG: cần tên; tùy chọn SĐT, ghi chú, lớp phụ trách. TÓM TẮT rồi chờ xác nhận → add_assistant.
- ĐIỂM DANH TRỢ GIẢNG: gọi find_assistant để lấy assistant_id + lớp phụ trách. Xác định các lớp trợ giảng đã dạy (theo lời người dùng), map sang class_id. Mặc định ngày = hôm nay. TÓM TẮT "Điểm danh [tên] ngày [d/m]: dạy [các lớp]. OK?" rồi chờ xác nhận → mark_assistant_taught.
- THỐNG KÊ BUỔI DẠY: dùng get_assistant_sessions (tháng, tùy chọn 1 trợ giảng) — chỉ đọc, trả lời dạng danh sách "Trợ giảng - Lớp - Số buổi".

QUY TẮC TRÌNH BÀY (rất quan trọng):
- Trả lời bằng tiếng Việt, ngắn gọn, dạng DANH SÁCH mỗi em một dòng.
- Khi liệt kê nợ/nộp phí NHIỀU lớp: mỗi dòng ghi "Tên - Lớp - Số tiền".
- Khi chỉ hỏi 1 lớp cụ thể: ghi tên lớp ở DÒNG ĐẦU (tiêu đề), rồi mỗi dòng chỉ ghi "Tên - Số tiền" (không lặp lại tên lớp).
- Số tiền viết có dấu chấm phân cách và "đ", ví dụ 600.000đ.
- Cuối danh sách có thể thêm 1 dòng tổng (số khoản, tổng tiền) nếu hợp lý.
- Nếu công cụ trả về need_clarification (tên lớp mơ hồ), hỏi lại người dùng chọn đúng lớp trong danh sách gợi ý.
- Nếu không có dữ liệu, nói rõ "Không có...".
- Không thêm tiêu đề thừa, không giải thích dài dòng. Nhớ toàn bộ hội thoại để trả lời liền mạch.`;
}

// ==================== HANDLER ====================

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0 || !String(messages[messages.length - 1]?.content || '').trim()) {
    return Response.json({ error: 'no_question' }, { status: 400 });
  }

  const keys = getGeminiKeys();
  if (!keys.length) return Response.json({ error: 'no_api_key' }, { status: 500 });

  // Chốt chặn ghi: chỉ cho mark_paid chạy khi tin nhắn CUỐI của người dùng là lời đồng ý.
  // Ngăn model tự tìm + ghi trong cùng 1 lượt mà chưa cho người dùng xác nhận.
  const lastUserMsg = String(messages[messages.length - 1]?.content || '').toLowerCase();
  const writeConfirmed =
    !/\b(không|khong|đừng|dung|khỏi|khoi|hủy|huy|thôi|thoi|sai|chưa|chua)\b/.test(lastUserMsg) &&
    /\b(ok|oke|okê|okay|đồng ý|dong y|đúng|dúng|ừ|ừa|ù|vâng|vang|có|co|yes|chốt|chot|xác nhận|xac nhan|được|duoc|đc|ừm|um)\b/.test(lastUserMsg);

  // messages: [{ role:'user'|'ai', content }]
  const contents: any[] = messages.map((m: any) => ({
    role: m.role === 'ai' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }],
  }));

  const sysInstruction = { parts: [{ text: systemPrompt() }] };

  // Vòng lặp function-calling: model gọi hàm → ta chạy → trả kết quả → lặp tới khi có câu trả lời chữ
  for (let i = 0; i < 12; i++) {
    const payload = JSON.stringify({
      systemInstruction: sysInstruction,
      contents,
      tools: TOOLS,
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    });

    let res: Response;
    try {
      res = await callGeminiRotate({ model: MODEL, keys, payload });
    } catch (e) {
      console.error('[chat] network error:', e);
      return Response.json({ error: 'network' }, { status: 500 });
    }

    if (res.status === 429) {
      const eb = await res.json().catch(() => ({}));
      return Response.json({ error: isDailyLimit(eb) ? 'quota_rpd' : 'quota_rpm' }, { status: 429 });
    }
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      console.error('[chat] gemini error', res.status, JSON.stringify(b));
      return Response.json({ error: 'gemini_error', details: b }, { status: 500 });
    }

    const data = await res.json();
    const modelContent = data.candidates?.[0]?.content;
    const parts = modelContent?.parts || [];
    // Gemini có thể phát NHIỀU functionCall song song trong 1 lượt (vd đóng phí 3 em) → chạy HẾT
    const fnCalls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);

    if (fnCalls.length > 0) {
      const responseParts: any[] = [];
      for (const fc of fnCalls) {
        let result: unknown;
        // Chặn ghi khi chưa có xác nhận rõ ràng ở tin nhắn cuối
        if (['mark_paid', 'save_attendance', 'add_student', 'transfer_student', 'rename_student', 'add_assistant', 'mark_assistant_taught'].includes(fc.name) && !writeConfirmed) {
          result = {
            error: 'chua_xac_nhan',
            message: 'CHƯA được phép ghi. Hãy TÓM TẮT (tên, lớp, tháng, số tiền) rồi HỎI người dùng xác nhận. Chỉ ghi sau khi người dùng đồng ý.',
          };
        } else {
          try {
            result = await runTool(fc.name, fc.args || {});
          } catch (e) {
            console.error('[chat] tool error', fc.name, e);
            result = { error: 'tool_failed', message: String(e) };
          }
        }
        responseParts.push({ functionResponse: { name: fc.name, response: { result } } });
      }
      // Đẩy lại NGUYÊN content của model (giữ thought_signature — Gemini 3.x bắt buộc) + toàn bộ kết quả
      contents.push(modelContent);
      contents.push({ role: 'user', parts: responseParts });
      continue;
    }

    const answer = parts.map((p: any) => p.text).filter(Boolean).join('').trim();
    if (!answer) return Response.json({ error: 'empty' }, { status: 500 });
    return Response.json({ answer });
  }

  return Response.json({ error: 'too_many_steps' }, { status: 500 });
}

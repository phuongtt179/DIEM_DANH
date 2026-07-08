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

async function toolAttendanceSummary(args: { class_name: string; month: string }) {
  const r = await resolveClass(args.class_name);
  if (!r.one) return { need_clarification: true, matches: (r.matches || []).map((c: any) => c.name) };
  const month = args.month || currentMonth();

  const { data } = await supabase
    .from('attendance')
    .select('student_id, status, students ( name )')
    .eq('class_id', r.one.id)
    .gte('date', `${month}-01`)
    .lte('date', `${month}-31`)
    .eq('status', 'absent');

  const counts: Record<string, { name: string; absent: number }> = {};
  (data || []).forEach((a: any) => {
    const key = a.student_id;
    if (!counts[key]) counts[key] = { name: a.students?.name || '?', absent: 0 };
    counts[key].absent += 1;
  });
  const list = Object.values(counts).sort((a, b) => b.absent - a.absent);
  return {
    lop: r.one.name,
    thang: month,
    danh_sach_vang: list.map(x => ({ ten: x.name, so_buoi_vang: x.absent })),
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
  if (!args.student_id || !args.class_id) return { error: 'thiếu student_id hoặc class_id — hãy dùng find_students trước' };

  const { data: cls } = await supabase.from('classes').select('name, tuition').eq('id', args.class_id).single();
  const amount = typeof args.amount === 'number' ? args.amount : (cls?.tuition ?? 0);

  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('student_id', args.student_id)
    .eq('class_id', args.class_id)
    .eq('month', month)
    .single();

  if (existing) {
    await supabase.from('payments').update({
      status: 'paid', amount, paid_date: todayStr(), note: args.note ?? null,
    }).eq('id', existing.id);
  } else {
    await supabase.from('payments').insert([{
      student_id: args.student_id, class_id: args.class_id, month,
      amount, sessions: 0, paid_date: todayStr(), status: 'paid', note: args.note ?? null,
    }]);
  }

  const { data: st } = await supabase.from('students').select('name').eq('id', args.student_id).single();
  return { ok: true, ten: st?.name, lop: cls?.name, thang: month, so_tien: amount, ngay_dong: todayStr(), ghi_chu: args.note ?? null };
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
  for (const st of students) {
    const status = absentSet.has(st.id) ? 'absent' : 'present';
    if (status === 'absent') absentNames.push(st.name);
    const eid = existMap.get(st.id);
    if (eid) {
      await supabase.from('attendance').update({ status }).eq('id', eid);
    } else {
      await supabase.from('attendance').insert([{ student_id: st.id, class_id: args.class_id, date, status, note: '' }]);
    }
  }

  const { data: cls } = await supabase.from('classes').select('name').eq('id', args.class_id).single();
  return { ok: true, lop: cls?.name, ngay: date, si_so: students.length, so_vang: absentNames.length, vang: absentNames };
}

// Bảng điều phối tên công cụ → hàm
async function runTool(name: string, args: any): Promise<unknown> {
  switch (name) {
    case 'list_classes': return toolListClasses();
    case 'list_students': return toolListStudents(args);
    case 'get_debts': return toolGetDebts(args);
    case 'get_payments': return toolGetPayments(args);
    case 'get_revenue': return toolGetRevenue(args);
    case 'get_attendance_summary': return toolAttendanceSummary(args);
    case 'find_students': return toolFindStudents(args);
    case 'mark_paid': return toolMarkPaid(args);
    case 'get_class_roster': return toolGetRoster(args);
    case 'save_attendance': return toolSaveAttendance(args);
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
      name: 'get_attendance_summary',
      description: 'Thống kê số buổi VẮNG của học sinh trong 1 lớp theo tháng.',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string', description: 'Tên lớp' },
          month: { type: 'string', description: 'Tháng, dạng YYYY-MM' },
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
  ],
}];

function systemPrompt(): string {
  return `Bạn là trợ lý tra cứu cho ứng dụng "Quản lý Lớp học" (điểm danh & học phí). Chỉ có MỘT người dùng là chủ trung tâm.

Hôm nay là ${todayStr()} (tháng hiện tại: ${currentMonth()}).

NHIỆM VỤ: Người dùng hỏi về dữ liệu lớp học (nợ học phí, ai đã nộp, doanh thu, sĩ số, điểm danh...) HOẶC ra lệnh THU HỌC PHÍ. Bạn GỌI CÔNG CỤ phù hợp để lấy/ghi dữ liệu THẬT. TUYỆT ĐỐI không bịa số liệu — luôn dựa vào kết quả công cụ.

BẠN LÀM ĐƯỢC:
- Tra cứu (đọc): nợ, đã nộp, doanh thu, sĩ số, thống kê vắng...
- THU HỌC PHÍ (ghi): đánh dấu học sinh đã đóng.
- ĐIỂM DANH (ghi): đánh dấu buổi học ai vắng.
Nếu người dùng yêu cầu thêm/sửa/xóa học sinh/lớp, lịch sự nói tính năng đó đang phát triển.

QUY TRÌNH THU HỌC PHÍ (bắt buộc theo đúng thứ tự, RẤT QUAN TRỌNG):
1. Gọi find_students để tìm đúng em (kèm lớp, học phí, trạng thái tháng).
2. Nếu KHÔNG tìm thấy → báo người dùng. Nếu có NHIỀU em trùng tên → liệt kê cho người dùng chọn. Nếu em thuộc NHIỀU lớp thu phí mà chưa rõ lớp nào → hỏi lớp nào.
3. Nếu em đó ở tháng này ĐÃ đóng rồi → báo cho người dùng biết, hỏi có muốn ghi đè không.
4. TÓM TẮT rõ trước khi ghi: "Xác nhận: [Tên] — [Lớp] — T[tháng]/[năm] — [số tiền]đ[ — ghi chú nếu có] → đánh dấu ĐÃ ĐÓNG. OK chứ?" rồi DỪNG LẠI chờ người dùng đồng ý.
5. CHỈ gọi mark_paid SAU KHI người dùng xác nhận (ok/đúng/ừ/đồng ý...). TUYỆT ĐỐI không gọi mark_paid ở lượt chưa có xác nhận.
6. Mặc định: tháng = tháng hiện tại; số tiền = học phí lớp (trừ khi người dùng nói số khác, ví dụ "đóng 300k").
7. Ghi xong báo lại ngắn gọn kết quả thật từ công cụ.

QUY TRÌNH ĐIỂM DANH (bắt buộc theo đúng thứ tự):
1. Gọi get_class_roster (theo tên lớp + ngày) để lấy danh sách học sinh và student_id.
2. Xác định các em VẮNG theo tên người dùng nói, map sang student_id trong roster. Nếu một tên KHÔNG có trong lớp hoặc mơ hồ (nhiều em trùng) → hỏi lại, đừng đoán bừa.
3. Mặc định ngày = HÔM NAY, trừ khi người dùng nói ngày khác.
4. TÓM TẮT trước khi ghi: "Điểm danh [Lớp] ngày [d/m]: VẮNG [tên các em] ([n] em); còn lại [si_so - n] em có mặt. OK chứ?" rồi DỪNG chờ đồng ý.
5. CHỈ gọi save_attendance SAU KHI người dùng xác nhận. Truyền absent_student_ids là student_id các em vắng (rỗng nếu cả lớp đi đủ).
6. Ghi xong báo lại ngắn gọn: lớp, ngày, số em vắng (kèm tên), số em có mặt.

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
  for (let i = 0; i < 6; i++) {
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
    const fnCall = parts.find((p: any) => p.functionCall)?.functionCall;

    if (fnCall) {
      let result: unknown;
      // Chặn ghi khi chưa có xác nhận rõ ràng ở tin nhắn cuối
      if ((fnCall.name === 'mark_paid' || fnCall.name === 'save_attendance') && !writeConfirmed) {
        result = {
          error: 'chua_xac_nhan',
          message: 'CHƯA được phép ghi. Hãy TÓM TẮT (tên, lớp, tháng, số tiền) rồi HỎI người dùng xác nhận. Chỉ ghi sau khi người dùng đồng ý.',
        };
      } else {
        try {
          result = await runTool(fnCall.name, fnCall.args || {});
        } catch (e) {
          console.error('[chat] tool error', fnCall.name, e);
          result = { error: 'tool_failed', message: String(e) };
        }
      }
      // Đẩy lại NGUYÊN content của model (giữ thought_signature — Gemini 3.x bắt buộc)
      contents.push(modelContent);
      contents.push({ role: 'user', parts: [{ functionResponse: { name: fnCall.name, response: { result } } }] });
      continue;
    }

    const answer = parts.map((p: any) => p.text).filter(Boolean).join('').trim();
    if (!answer) return Response.json({ error: 'empty' }, { status: 500 });
    return Response.json({ answer });
  }

  return Response.json({ error: 'too_many_steps' }, { status: 500 });
}

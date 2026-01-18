'use client';

import { useEffect, useState } from 'react';
import { supabase, Student, Class, Payment } from '@/lib/supabase';
import { X } from 'lucide-react';
import { format } from 'date-fns';

interface PaymentRecord {
  studentId: string;
  studentName: string;
  amount: number;
  sessions: number;
  calculatedSessions?: number; // Auto-calculated from attendance
  allClassesNames?: string[]; // List of all classes for this student
  status: 'paid' | 'unpaid';
  paidDate: string | null;
  note: string | null;
}

export default function PaymentsPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    sessions: '',
    paidDate: format(new Date(), 'yyyy-MM-dd'),
    note: '',
  });

  // Helper function to calculate sessions from attendance across ALL classes
  async function calculateSessionsForStudent(
    studentId: string,
    month: string
  ): Promise<{ sessions: number; classNames: string[] }> {
    try {
      // Parse month (YYYY-MM)
      const [year, monthNum] = month.split('-');
      const startDate = `${year}-${monthNum}-01`;
      const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
      const endDate = `${year}-${monthNum}-${String(lastDay).padStart(2, '0')}`;

      // Get ALL classes for this student
      const { data: studentClasses, error: scError } = await supabase
        .from('student_classes')
        .select(`
          class_id,
          classes (
            id,
            name
          )
        `)
        .eq('student_id', studentId);

      if (scError) throw scError;

      if (!studentClasses || studentClasses.length === 0) {
        return { sessions: 0, classNames: [] };
      }

      const classIds = studentClasses.map((sc: any) => sc.class_id);
      const classNames = studentClasses.map((sc: any) => sc.classes.name);

      // Count attendance records where status = 'present' across ALL classes
      const { data: attendanceData, error: attError } = await supabase
        .from('attendance')
        .select('id')
        .eq('student_id', studentId)
        .in('class_id', classIds)
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('status', 'present'); // Only count 'present' status

      if (attError) throw attError;

      return {
        sessions: attendanceData?.length || 0,
        classNames: classNames,
      };
    } catch (error) {
      console.error('Error calculating sessions:', error);
      return { sessions: 0, classNames: [] };
    }
  }

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (selectedClassId && selectedMonth) {
      loadPayments();
    }
  }, [selectedClassId, selectedMonth]);

  async function loadClasses() {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .order('name');

      if (error) throw error;
      setClasses(data || []);
      if (data && data.length > 0) {
        setSelectedClassId(data[0].id);
      }
    } catch (error) {
      console.error('Error loading classes:', error);
    }
  }

  async function loadPayments() {
    try {
      setLoading(true);

      // Get students WHERE this is their PRIMARY class
      const { data: studentClassesData, error: scError } = await supabase
        .from('student_classes')
        .select(`
          student_id,
          students (
            id,
            name
          )
        `)
        .eq('class_id', selectedClassId)
        .eq('is_primary', true); // ONLY primary class students

      if (scError) throw scError;

      const { data: classData, error: classError } = await supabase
        .from('classes')
        .select('tuition')
        .eq('id', selectedClassId)
        .single();

      if (classError) throw classError;

      const { data: existingPayments, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('class_id', selectedClassId)
        .eq('month', selectedMonth);

      if (paymentsError) throw paymentsError;

      // Calculate sessions for each student across ALL their classes
      const records: PaymentRecord[] = await Promise.all(
        (studentClassesData || []).map(async (sc: any) => {
          const student = sc.students;
          const existing = existingPayments?.find(p => p.student_id === student.id);

          // AUTO-CALCULATE sessions from attendance across ALL classes
          const { sessions: calculatedSessions, classNames } = await calculateSessionsForStudent(
            student.id,
            selectedMonth
          );

          return {
            studentId: student.id,
            studentName: student.name,
            amount: existing?.amount || classData?.tuition || 0,
            sessions: existing?.sessions || calculatedSessions, // Use saved OR calculated
            calculatedSessions: calculatedSessions, // Store for display/comparison
            allClassesNames: classNames, // All classes contributing to sessions
            status: existing?.status || 'unpaid',
            paidDate: existing?.paid_date || null,
            note: existing?.note || null,
          };
        })
      );

      setPaymentRecords(records);
    } catch (error) {
      console.error('Error loading payments:', error);
      alert('Lỗi khi tải thông tin học phí');
    } finally {
      setLoading(false);
    }
  }

  function openPaymentModal(studentId: string) {
    const record = paymentRecords.find(r => r.studentId === studentId);
    if (!record) return;

    setEditingPayment(record);
    setPaymentForm({
      amount: record.amount.toString(),
      sessions: (record.calculatedSessions || 0).toString(),
      paidDate: record.paidDate || format(new Date(), 'yyyy-MM-dd'),
      note: record.note || '',
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingPayment(null);
    setPaymentForm({
      amount: '',
      sessions: '',
      paidDate: format(new Date(), 'yyyy-MM-dd'),
      note: '',
    });
  }

  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPayment) return;

    try {
      setSaving(true);

      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('student_id', editingPayment.studentId)
        .eq('class_id', selectedClassId)
        .eq('month', selectedMonth)
        .single();

      if (existing) {
        await supabase
          .from('payments')
          .update({
            status: 'paid',
            amount: parseFloat(paymentForm.amount),
            sessions: parseInt(paymentForm.sessions),
            paid_date: paymentForm.paidDate,
            note: paymentForm.note || null,
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('payments')
          .insert([{
            student_id: editingPayment.studentId,
            class_id: selectedClassId,
            month: selectedMonth,
            amount: parseFloat(paymentForm.amount),
            sessions: parseInt(paymentForm.sessions),
            paid_date: paymentForm.paidDate,
            status: 'paid',
            note: paymentForm.note || null,
          }]);
      }

      setPaymentRecords(records =>
        records.map(r =>
          r.studentId === editingPayment.studentId
            ? {
                ...r,
                status: 'paid',
                amount: parseFloat(paymentForm.amount),
                sessions: parseInt(paymentForm.sessions),
                paidDate: paymentForm.paidDate,
                note: paymentForm.note || null,
              }
            : r
        )
      );

      alert('Đã cập nhật học phí thành công!');
      closeModal();
    } catch (error) {
      console.error('Error saving payment:', error);
      alert('Lỗi khi lưu học phí');
    } finally {
      setSaving(false);
    }
  }

  async function markAsUnpaid(studentId: string) {
    try {
      setSaving(true);

      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('student_id', studentId)
        .eq('class_id', selectedClassId)
        .eq('month', selectedMonth)
        .single();

      if (!existing) return;

      await supabase
        .from('payments')
        .update({
          status: 'unpaid',
          paid_date: null,
        })
        .eq('id', existing.id);

      setPaymentRecords(records =>
        records.map(r =>
          r.studentId === studentId
            ? { ...r, status: 'unpaid', paidDate: null }
            : r
        )
      );

      alert('Đã đánh dấu học phí chưa đóng!');
    } catch (error) {
      console.error('Error marking payment:', error);
      alert('Lỗi khi cập nhật học phí');
    } finally {
      setSaving(false);
    }
  }

  // Filter records based on status and sort by paidDate for paid students
  const filteredRecords = (() => {
    let records = filterStatus === 'all'
      ? paymentRecords
      : paymentRecords.filter(r => r.status === filterStatus);

    // Sort paid students by payment date (newest first)
    if (filterStatus === 'paid') {
      records = [...records].sort((a, b) => {
        if (!a.paidDate && !b.paidDate) return 0;
        if (!a.paidDate) return 1;
        if (!b.paidDate) return -1;
        return new Date(b.paidDate).getTime() - new Date(a.paidDate).getTime();
      });
    }

    return records;
  })();

  const stats = {
    total: paymentRecords.length,
    paid: paymentRecords.filter(r => r.status === 'paid').length,
    unpaid: paymentRecords.filter(r => r.status === 'unpaid').length,
    totalAmount: paymentRecords.reduce((sum, r) => sum + r.amount, 0),
    paidAmount: paymentRecords.filter(r => r.status === 'paid').reduce((sum, r) => sum + r.amount, 0),
    unpaidAmount: paymentRecords.filter(r => r.status === 'unpaid').reduce((sum, r) => sum + r.amount, 0),
  };

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 lg:mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Quản lý Học phí</h1>
        <p className="text-sm lg:text-base text-gray-600 mt-1">Theo dõi học phí đã đóng/chưa đóng theo tháng</p>
      </div>

      {/* Controls */}
      <div className="bg-white p-4 lg:p-6 rounded-lg shadow mb-4 lg:mb-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Lớp <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
            >
              {classes.length === 0 ? (
                <option value="">Chưa có lớp học</option>
              ) : (
                classes.map((classItem) => (
                  <option key={classItem.id} value={classItem.id}>
                    {classItem.name} - {classItem.tuition.toLocaleString('vi-VN')} đ/tháng
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Tháng <span className="text-red-500">*</span>
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full max-w-full min-w-0 px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
            />
          </div>
        </div>

        {/* Stats - Clickable to filter */}
        {paymentRecords.length > 0 && (
          <div className="grid grid-cols-3 gap-2 lg:gap-4 pt-4 border-t">
            <div
              onClick={() => setFilterStatus('all')}
              className={`p-2 lg:p-4 rounded-lg cursor-pointer transition-all ${
                filterStatus === 'all'
                  ? 'bg-blue-100 ring-2 ring-blue-500'
                  : 'bg-blue-50 hover:bg-blue-100'
              }`}
            >
              <p className="text-xs lg:text-sm text-gray-600 mb-1">Tổng số HS</p>
              <p className="text-xl lg:text-2xl font-bold text-blue-600">{stats.total}</p>
            </div>
            <div
              onClick={() => setFilterStatus('paid')}
              className={`p-2 lg:p-4 rounded-lg cursor-pointer transition-all ${
                filterStatus === 'paid'
                  ? 'bg-green-100 ring-2 ring-green-500'
                  : 'bg-green-50 hover:bg-green-100'
              }`}
            >
              <p className="text-xs lg:text-sm text-gray-600 mb-1">Đã đóng</p>
              <p className="text-xl lg:text-2xl font-bold text-green-600">{stats.paid}</p>
              <p className="text-xs text-gray-600 mt-1 hidden lg:block">{stats.paidAmount.toLocaleString('vi-VN')} đ</p>
            </div>
            <div
              onClick={() => setFilterStatus('unpaid')}
              className={`p-2 lg:p-4 rounded-lg cursor-pointer transition-all ${
                filterStatus === 'unpaid'
                  ? 'bg-red-100 ring-2 ring-red-500'
                  : 'bg-red-50 hover:bg-red-100'
              }`}
            >
              <p className="text-xs lg:text-sm text-gray-600 mb-1">Chưa đóng</p>
              <p className="text-xl lg:text-2xl font-bold text-red-600">{stats.unpaid}</p>
              <p className="text-xs text-gray-600 mt-1 hidden lg:block">{stats.unpaidAmount.toLocaleString('vi-VN')} đ</p>
            </div>
          </div>
        )}
      </div>

      {/* Payment List */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : !selectedClassId ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500 text-sm lg:text-lg">Vui lòng chọn lớp để quản lý học phí</p>
        </div>
      ) : paymentRecords.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500 text-sm lg:text-lg">Lớp này chưa có học sinh</p>
          <p className="text-gray-400 text-xs lg:text-sm mt-2">Thêm học sinh để quản lý học phí</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">STT</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">Tên học sinh</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-center text-xs lg:text-sm font-bold text-gray-700">Số buổi học</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-right text-xs lg:text-sm font-bold text-gray-700">Học phí</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-center text-xs lg:text-sm font-bold text-gray-700">Ngày đóng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRecords.map((record, index) => (
                <tr
                  key={record.studentId}
                  onClick={() => openPaymentModal(record.studentId)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-gray-600">{index + 1}</td>
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base font-semibold text-gray-800">{record.studentName}</td>
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-center text-gray-600">{record.calculatedSessions || 0} buổi</td>
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-right font-semibold text-gray-800">
                    {record.amount.toLocaleString('vi-VN')} đ
                  </td>
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-center">
                    {record.paidDate ? (
                      <span className="text-green-600 font-semibold">
                        {format(new Date(record.paidDate), 'dd/MM/yyyy')}
                      </span>
                    ) : (
                      <span className="text-red-600 font-semibold">Chưa đóng</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Payment Modal */}
      {showModal && editingPayment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 lg:p-6 border-b sticky top-0 bg-white">
              <h2 className="text-lg lg:text-2xl font-bold text-gray-800">
                {editingPayment.status === 'paid' ? 'Sửa học phí' : 'Đánh dấu đã đóng'}
              </h2>
              <button
                onClick={closeModal}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="p-4 lg:p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Học sinh
                </label>
                <input
                  type="text"
                  value={editingPayment.studentName}
                  disabled
                  className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg bg-gray-50 text-gray-600 text-sm lg:text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Số buổi học <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="1"
                  value={paymentForm.sessions}
                  onChange={(e) => setPaymentForm({ ...paymentForm, sessions: e.target.value })}
                  className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
                  placeholder="VD: 4"
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-gray-600">
                    Tự động tính: <span className="font-semibold text-blue-600">{editingPayment.calculatedSessions || 0} buổi</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setPaymentForm({
                      ...paymentForm,
                      sessions: (editingPayment.calculatedSessions || 0).toString()
                    })}
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-semibold"
                  >
                    Áp dụng
                  </button>
                </div>
                {editingPayment.allClassesNames && editingPayment.allClassesNames.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    Từ các lớp: {editingPayment.allClassesNames.join(', ')}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Số tiền (VNĐ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="1000"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
                  placeholder="VD: 500000"
                />
                <p className="text-xs lg:text-sm text-gray-500 mt-1">
                  Học phí mặc định: {editingPayment.amount.toLocaleString('vi-VN')} đ
                </p>
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Ngày đóng <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={paymentForm.paidDate}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paidDate: e.target.value })}
                  className="w-full max-w-full min-w-0 px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Ghi chú
                </label>
                <textarea
                  value={paymentForm.note}
                  onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                  className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
                  placeholder="VD: Nộp CK TK1, Tiền mặt..."
                  rows={2}
                />
              </div>

              <div className="flex flex-col gap-3 pt-4">
                {editingPayment.status === 'paid' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const confirm = window.confirm(
                        `Bạn có chắc muốn đánh dấu "${editingPayment.studentName}" là CHƯA ĐÓNG học phí?`
                      );
                      if (confirm) {
                        await markAsUnpaid(editingPayment.studentId);
                        closeModal();
                      }
                    }}
                    disabled={saving}
                    className="w-full px-4 lg:px-6 py-2 lg:py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold disabled:bg-gray-300 text-sm lg:text-base"
                  >
                    Đánh dấu chưa đóng
                  </button>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 px-4 lg:px-6 py-2 lg:py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold text-sm lg:text-base"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-4 lg:px-6 py-2 lg:py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold disabled:bg-gray-300 text-sm lg:text-base"
                  >
                    {saving ? 'Đang lưu...' : 'Xác nhận'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

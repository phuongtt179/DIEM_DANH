'use client';

import { useEffect, useState } from 'react';
import { supabase, Student, Class, Payment } from '@/lib/supabase';
import { DollarSign, CheckCircle, XCircle, X } from 'lucide-react';
import { format } from 'date-fns';

interface PaymentRecord {
  studentId: string;
  studentName: string;
  amount: number;
  sessions: number;
  status: 'paid' | 'unpaid';
  paidDate: string | null;
}

export default function PaymentsPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    sessions: '',
    paidDate: format(new Date(), 'yyyy-MM-dd'),
  });

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

      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('*')
        .eq('class_id', selectedClassId)
        .order('name');

      if (studentsError) throw studentsError;

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

      const records: PaymentRecord[] = (students || []).map((student) => {
        const existing = existingPayments?.find(p => p.student_id === student.id);
        return {
          studentId: student.id,
          studentName: student.name,
          amount: existing?.amount || classData?.tuition || 0,
          sessions: existing?.sessions || 1,
          status: existing?.status || 'unpaid',
          paidDate: existing?.paid_date || null,
        };
      });

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
      sessions: record.sessions.toString(),
      paidDate: record.paidDate || format(new Date(), 'yyyy-MM-dd'),
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
                paidDate: paymentForm.paidDate
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

        {/* Stats */}
        {paymentRecords.length > 0 && (
          <div className="grid grid-cols-3 gap-2 lg:gap-4 pt-4 border-t">
            <div className="bg-blue-50 p-2 lg:p-4 rounded-lg">
              <p className="text-xs lg:text-sm text-gray-600 mb-1">Tổng số HS</p>
              <p className="text-xl lg:text-2xl font-bold text-blue-600">{stats.total}</p>
            </div>
            <div className="bg-green-50 p-2 lg:p-4 rounded-lg">
              <p className="text-xs lg:text-sm text-gray-600 mb-1">Đã đóng</p>
              <p className="text-xl lg:text-2xl font-bold text-green-600">{stats.paid}</p>
              <p className="text-xs text-gray-600 mt-1 hidden lg:block">{stats.paidAmount.toLocaleString('vi-VN')} đ</p>
            </div>
            <div className="bg-red-50 p-2 lg:p-4 rounded-lg">
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
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-bold text-gray-700">STT</th>
                  <th className="px-6 py-4 text-left text-sm font-bold text-gray-700">Họ tên</th>
                  <th className="px-6 py-4 text-center text-sm font-bold text-gray-700">Số buổi</th>
                  <th className="px-6 py-4 text-right text-sm font-bold text-gray-700">Số tiền</th>
                  <th className="px-6 py-4 text-center text-sm font-bold text-gray-700">Trạng thái</th>
                  <th className="px-6 py-4 text-center text-sm font-bold text-gray-700">Ngày đóng</th>
                  <th className="px-6 py-4 text-center text-sm font-bold text-gray-700">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paymentRecords.map((record, index) => (
                  <tr key={record.studentId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-gray-600">{index + 1}</td>
                    <td className="px-6 py-4 font-semibold text-gray-800">{record.studentName}</td>
                    <td className="px-6 py-4 text-center text-gray-600">{record.sessions} buổi</td>
                    <td className="px-6 py-4 text-right font-semibold text-gray-800">
                      {record.amount.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="px-6 py-4 text-center">
                      {record.status === 'paid' ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                          <CheckCircle size={16} />
                          Đã đóng
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-semibold">
                          <XCircle size={16} />
                          Chưa đóng
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-600">
                      {record.paidDate ? format(new Date(record.paidDate), 'dd/MM/yyyy') : '-'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        {record.status === 'unpaid' ? (
                          <button
                            onClick={() => openPaymentModal(record.studentId)}
                            disabled={saving}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold text-sm disabled:bg-gray-300"
                          >
                            <CheckCircle size={16} className="inline mr-1" />
                            Đánh dấu đã đóng
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => openPaymentModal(record.studentId)}
                              disabled={saving}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm disabled:bg-gray-300"
                            >
                              Sửa
                            </button>
                            <button
                              onClick={() => markAsUnpaid(record.studentId)}
                              disabled={saving}
                              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold text-sm disabled:bg-gray-300"
                            >
                              <XCircle size={16} className="inline mr-1" />
                              Đánh dấu chưa đóng
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-3">
            {paymentRecords.map((record, index) => (
              <div
                key={record.studentId}
                onClick={() => record.status === 'unpaid' && openPaymentModal(record.studentId)}
                className={`bg-white rounded-lg shadow-md p-4 border-l-4 ${
                  record.status === 'paid' ? 'border-green-500' : 'border-red-500 cursor-pointer active:bg-gray-50'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">#{index + 1}</span>
                      <h3 className="font-bold text-gray-800">{record.studentName}</h3>
                    </div>
                    <div className="mt-2 space-y-1">
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Số buổi:</span> {record.sessions} buổi
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Số tiền:</span> {record.amount.toLocaleString('vi-VN')} đ
                      </p>
                      {record.paidDate && (
                        <p className="text-sm text-gray-600">
                          <span className="font-semibold">Ngày đóng:</span> {format(new Date(record.paidDate), 'dd/MM/yyyy')}
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    {record.status === 'paid' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                        <CheckCircle size={14} />
                        Đã đóng
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                        <XCircle size={14} />
                        Chưa đóng
                      </span>
                    )}
                  </div>
                </div>
                {record.status === 'paid' && (
                  <div className="flex gap-2 mt-3 pt-3 border-t">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openPaymentModal(record.studentId);
                      }}
                      disabled={saving}
                      className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm disabled:bg-gray-300"
                    >
                      Sửa
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsUnpaid(record.studentId);
                      }}
                      disabled={saving}
                      className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold text-sm disabled:bg-gray-300 flex items-center justify-center gap-1"
                    >
                      <XCircle size={14} />
                      Chưa đóng
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
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
                  min="1"
                  step="1"
                  value={paymentForm.sessions}
                  onChange={(e) => setPaymentForm({ ...paymentForm, sessions: e.target.value })}
                  className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
                  placeholder="VD: 4"
                />
                <p className="text-xs lg:text-sm text-gray-500 mt-1">
                  Tổng số buổi học trong tháng này
                </p>
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

              <div className="flex gap-3 pt-4">
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
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { supabase, Class } from '@/lib/supabase';
import { Plus, Edit2, Trash2, X, Lock, Unlock, ArrowRight } from 'lucide-react';

interface StudentInClass {
  studentId: string;
  studentName: string;
  isPrimary: boolean;
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferringClass, setTransferringClass] = useState<Class | null>(null);
  const [studentsInLockedClass, setStudentsInLockedClass] = useState<StudentInClass[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [targetClassId, setTargetClassId] = useState<string>('');
  const [transferring, setTransferring] = useState(false);
  const [editingClass, setEditingClass] = useState<Class | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    schedule: '',
    tuition: '',
  });

  useEffect(() => {
    loadClasses();
  }, []);

  async function loadClasses() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClasses(data || []);
    } catch (error) {
      console.error('Error loading classes:', error);
      alert('Lỗi khi tải danh sách lớp học');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    try {
      if (editingClass) {
        const { error } = await supabase
          .from('classes')
          .update({
            name: formData.name,
            subject: formData.subject,
            schedule: formData.schedule,
            tuition: parseFloat(formData.tuition),
          })
          .eq('id', editingClass.id);

        if (error) throw error;
        alert('Cập nhật lớp học thành công!');
      } else {
        const { error } = await supabase
          .from('classes')
          .insert([{
            name: formData.name,
            subject: formData.subject,
            schedule: formData.schedule,
            tuition: parseFloat(formData.tuition),
            status: 'active',
          }]);

        if (error) throw error;
        alert('Thêm lớp học thành công!');
      }

      closeModal();
      loadClasses();
    } catch (error) {
      console.error('Error saving class:', error);
      alert('Lỗi khi lưu lớp học');
    }
  }

  async function handleDelete(classId: string, className: string) {
    if (!confirm(`Bạn có chắc muốn xóa lớp "${className}"?\nLưu ý: Tất cả học sinh, điểm danh và học phí liên quan sẽ bị xóa.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('classes')
        .delete()
        .eq('id', classId);

      if (error) throw error;
      alert('Xóa lớp học thành công!');
      loadClasses();
    } catch (error) {
      console.error('Error deleting class:', error);
      alert('Lỗi khi xóa lớp học');
    }
  }

  async function handleToggleLock(classItem: Class) {
    const isLocking = classItem.status !== 'locked';
    const action = isLocking ? 'KHÓA' : 'mở khóa';
    const warning = isLocking
      ? `Khóa lớp "${classItem.name}"?\n\nSau khi khóa:\n- Lớp sẽ ẩn khỏi điểm danh và thu học phí\n- Dữ liệu lịch sử vẫn được giữ nguyên\n- Bạn có thể mở khóa lại bất cứ lúc nào`
      : `Mở khóa lớp "${classItem.name}"?\n\nLớp sẽ hiện lại trong điểm danh và thu học phí.`;

    if (!confirm(warning)) return;

    try {
      const newStatus = isLocking ? 'locked' : 'active';
      const { error } = await supabase
        .from('classes')
        .update({
          status: newStatus,
          locked_at: isLocking ? new Date().toISOString() : null,
        })
        .eq('id', classItem.id);

      if (error) throw error;
      loadClasses();
    } catch (error) {
      console.error('Error toggling class lock:', error);
      alert('Lỗi khi thay đổi trạng thái lớp');
    }
  }

  async function openTransferModal(classItem: Class) {
    setTransferringClass(classItem);
    setSelectedStudentIds(new Set());
    setTargetClassId('');

    try {
      const { data, error } = await supabase
        .from('student_classes')
        .select(`
          student_id,
          is_primary,
          students (id, name)
        `)
        .eq('class_id', classItem.id);

      if (error) throw error;

      const students: StudentInClass[] = (data || []).map((sc: any) => ({
        studentId: sc.student_id,
        studentName: sc.students.name,
        isPrimary: sc.is_primary,
      }));
      students.sort((a, b) => a.studentName.localeCompare(b.studentName, 'vi'));
      setStudentsInLockedClass(students);
    } catch (error) {
      console.error('Error loading students:', error);
      alert('Lỗi khi tải danh sách học sinh');
      return;
    }

    setShowTransferModal(true);
  }

  function toggleStudentSelection(studentId: string) {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedStudentIds.size === studentsInLockedClass.length) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(studentsInLockedClass.map(s => s.studentId)));
    }
  }

  async function handleTransfer() {
    if (selectedStudentIds.size === 0) {
      alert('Vui lòng chọn ít nhất một học sinh');
      return;
    }
    if (!targetClassId) {
      alert('Vui lòng chọn lớp đích');
      return;
    }

    setTransferring(true);
    try {
      const studentsToTransfer = studentsInLockedClass.filter(s => selectedStudentIds.has(s.studentId));

      for (const student of studentsToTransfer) {
        // Remove from current (locked) class
        await supabase
          .from('student_classes')
          .delete()
          .eq('student_id', student.studentId)
          .eq('class_id', transferringClass!.id);

        // Check if already in target class
        const { data: existing } = await supabase
          .from('student_classes')
          .select('id')
          .eq('student_id', student.studentId)
          .eq('class_id', targetClassId)
          .maybeSingle();

        if (!existing) {
          await supabase
            .from('student_classes')
            .insert([{
              student_id: student.studentId,
              class_id: targetClassId,
              is_primary: student.isPrimary,
            }]);
        }
      }

      alert(`Đã chuyển ${studentsToTransfer.length} học sinh sang lớp mới thành công!\n\nDữ liệu điểm danh và học phí cũ vẫn được giữ nguyên.`);
      setShowTransferModal(false);
      loadClasses();
    } catch (error) {
      console.error('Error transferring students:', error);
      alert('Lỗi khi chuyển học sinh');
    } finally {
      setTransferring(false);
    }
  }

  function openAddModal() {
    setEditingClass(null);
    setFormData({ name: '', subject: '', schedule: '', tuition: '' });
    setShowModal(true);
  }

  function openEditModal(classItem: Class) {
    setEditingClass(classItem);
    setFormData({
      name: classItem.name,
      subject: classItem.subject,
      schedule: classItem.schedule,
      tuition: classItem.tuition.toString(),
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingClass(null);
    setFormData({ name: '', subject: '', schedule: '', tuition: '' });
  }

  const activeClasses = classes.filter(c => c.status !== 'locked');
  const lockedClasses = classes.filter(c => c.status === 'locked');
  const activeClassesForTransfer = classes.filter(c => c.status !== 'locked' && c.id !== transferringClass?.id);

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Quản lý Lớp học</h1>
          <p className="text-gray-600 mt-1">Danh sách các lớp dạy thêm</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-lg hover:shadow-xl"
        >
          <Plus size={20} />
          Thêm lớp học
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : classes.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500 text-lg">Chưa có lớp học nào</p>
          <p className="text-gray-400 mt-2">Nhấn "Thêm lớp học" để bắt đầu</p>
        </div>
      ) : (
        <>
          {/* Active Classes */}
          {activeClasses.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-bold text-gray-700 mb-3">
                Lớp đang hoạt động ({activeClasses.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeClasses.map((classItem) => (
                  <div
                    key={classItem.id}
                    className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all p-6 border-2 border-transparent hover:border-blue-400"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-xl font-bold text-gray-800">{classItem.name}</h3>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEditModal(classItem)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Sửa"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => handleToggleLock(classItem)}
                          className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                          title="Khóa lớp"
                        >
                          <Lock size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(classItem.id, classItem.name)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Xóa"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2 text-gray-600">
                      <p><span className="font-semibold">Môn học:</span> {classItem.subject}</p>
                      <p><span className="font-semibold">Lịch học:</span> {classItem.schedule}</p>
                      <p className="text-lg font-bold text-blue-600 mt-3">
                        {classItem.tuition.toLocaleString('vi-VN')} đ/tháng
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Locked Classes */}
          {lockedClasses.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-gray-500 mb-3 flex items-center gap-2">
                <Lock size={18} />
                Lớp đã khóa ({lockedClasses.length})
                <span className="text-sm font-normal text-gray-400">— Ẩn khỏi điểm danh và thu học phí</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {lockedClasses.map((classItem) => (
                  <div
                    key={classItem.id}
                    className="bg-gray-100 rounded-xl shadow-sm p-6 border-2 border-gray-200 opacity-80"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-bold text-gray-500">{classItem.name}</h3>
                        <span className="px-2 py-0.5 bg-gray-400 text-white text-xs rounded-full font-semibold">KHÓA</span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openTransferModal(classItem)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Chuyển học sinh sang lớp mới"
                        >
                          <ArrowRight size={18} />
                        </button>
                        <button
                          onClick={() => handleToggleLock(classItem)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Mở khóa lớp"
                        >
                          <Unlock size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(classItem.id, classItem.name)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Xóa"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2 text-gray-500">
                      <p><span className="font-semibold">Môn học:</span> {classItem.subject}</p>
                      <p><span className="font-semibold">Lịch học:</span> {classItem.schedule}</p>
                      <p className="text-lg font-bold text-gray-400 mt-3">
                        {classItem.tuition.toLocaleString('vi-VN')} đ/tháng
                      </p>
                      {classItem.locked_at && (
                        <p className="text-xs text-gray-400">
                          Khóa lúc: {new Date(classItem.locked_at).toLocaleDateString('vi-VN')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => openTransferModal(classItem)}
                      className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                    >
                      <ArrowRight size={16} />
                      Chuyển học sinh sang lớp mới
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-800">
                {editingClass ? 'Sửa lớp học' : 'Thêm lớp học mới'}
              </h2>
              <button
                onClick={closeModal}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Tên lớp <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  placeholder="VD: Toán 10A"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Môn học <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  placeholder="VD: Toán"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Lịch học <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.schedule}
                  onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  placeholder="VD: T2, T4, T6 - 18:00"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Học phí/tháng (VNĐ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="1000"
                  value={formData.tuition}
                  onChange={(e) => setFormData({ ...formData, tuition: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  placeholder="VD: 500000"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                >
                  {editingClass ? 'Cập nhật' : 'Thêm lớp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Students Modal */}
      {showTransferModal && transferringClass && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-6 border-b">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Chuyển học sinh</h2>
                <p className="text-sm text-gray-500 mt-1">Từ lớp: <span className="font-semibold">{transferringClass.name}</span></p>
              </div>
              <button
                onClick={() => setShowTransferModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {/* Target class selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Chuyển sang lớp <span className="text-red-500">*</span>
                </label>
                <select
                  value={targetClassId}
                  onChange={(e) => setTargetClassId(e.target.value)}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                >
                  <option value="">-- Chọn lớp đích --</option>
                  {activeClassesForTransfer.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.subject})
                    </option>
                  ))}
                </select>
                {activeClassesForTransfer.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">Không có lớp đang hoạt động. Hãy tạo lớp mới trước.</p>
                )}
              </div>

              {/* Student list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">
                    Chọn học sinh ({selectedStudentIds.size}/{studentsInLockedClass.length})
                  </label>
                  {studentsInLockedClass.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="text-xs text-blue-600 hover:underline font-semibold"
                    >
                      {selectedStudentIds.size === studentsInLockedClass.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  )}
                </div>

                {studentsInLockedClass.length === 0 ? (
                  <div className="text-center py-6 bg-gray-50 rounded-lg">
                    <p className="text-gray-500 text-sm">Lớp này không có học sinh</p>
                  </div>
                ) : (
                  <div className="border-2 border-gray-200 rounded-lg divide-y max-h-64 overflow-y-auto">
                    {studentsInLockedClass.map((student) => (
                      <label
                        key={student.studentId}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.has(student.studentId)}
                          onChange={() => toggleStudentSelection(student.studentId)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="flex-1 text-sm text-gray-800 font-medium">{student.studentName}</span>
                        {student.isPrimary && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">Lớp chính</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-700">
                  <strong>Lưu ý:</strong> Dữ liệu điểm danh và học phí cũ của học sinh sẽ được giữ nguyên ở lớp này. Học sinh sẽ xuất hiện ở lớp mới từ sau khi chuyển.
                </p>
              </div>
            </div>

            <div className="p-6 border-t flex gap-3">
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleTransfer}
                disabled={transferring || selectedStudentIds.size === 0 || !targetClassId}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                <ArrowRight size={18} />
                {transferring ? 'Đang chuyển...' : `Chuyển ${selectedStudentIds.size > 0 ? selectedStudentIds.size : ''} học sinh`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

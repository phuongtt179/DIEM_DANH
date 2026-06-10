'use client';

import { useEffect, useState } from 'react';
import { supabase, Student, Class, StudentWithClasses } from '@/lib/supabase';
import { Plus, Edit2, Trash2, X, Filter, PauseCircle, PlayCircle } from 'lucide-react';

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentWithClasses[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentWithClasses | null>(null);
  const [filterClassId, setFilterClassId] = useState<string>('all');
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    parent_phone: '',
    note: '',
    primary_class_id: '',
    secondary_class_ids: [] as string[],
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    await Promise.all([loadClasses(), loadStudents()]);
  }

  async function loadClasses() {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .order('name');

      if (error) throw error;
      setClasses(data || []);
    } catch (error) {
      console.error('Error loading classes:', error);
    }
  }

  async function handleToggleLeave(student: StudentWithClasses) {
    const isOnLeave = student.status === 'on_leave';
    const action = isOnLeave ? 'kích hoạt lại' : 'chuyển sang tạm nghỉ';
    const warning = isOnLeave
      ? `Kích hoạt lại "${student.name}"?\n\nHọc sinh sẽ xuất hiện trở lại trong điểm danh và thu học phí.`
      : `Chuyển "${student.name}" sang tạm nghỉ?\n\nHọc sinh sẽ ẩn khỏi điểm danh và thu học phí cho đến khi được kích hoạt lại.`;

    if (!confirm(warning)) return;

    try {
      const newStatus = isOnLeave ? 'active' : 'on_leave';
      const { error } = await supabase
        .from('students')
        .update({ status: newStatus })
        .eq('id', student.id);

      if (error) throw error;
      loadStudents();
    } catch (error) {
      console.error('Error toggling leave status:', error);
      alert('Lỗi khi thay đổi trạng thái học sinh');
    }
  }

  async function loadStudents() {
    try {
      setLoading(true);

      // Load all students with status
      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select('*')
        .order('name');

      if (studentsError) throw studentsError;

      // Load student-class relationships with class info
      const { data: studentClassesData, error: scError } = await supabase
        .from('student_classes')
        .select(`
          student_id,
          class_id,
          is_primary,
          classes (
            id,
            name,
            subject,
            status
          )
        `);

      if (scError) throw scError;

      // Merge data: each student gets primary_class + secondary_classes arrays
      const studentsWithClasses = (studentsData || []).map((student: any) => {
        const studentClasses = (studentClassesData || []).filter(
          (sc: any) => sc.student_id === student.id
        );
        const primaryClass = studentClasses.find((sc: any) => sc.is_primary);
        const secondaryClasses = studentClasses.filter((sc: any) => !sc.is_primary);

        return {
          ...student,
          primary_class: primaryClass?.classes,
          secondary_classes: secondaryClasses.map((sc: any) => sc.classes),
          class_count: studentClasses.length,
          class_name: (primaryClass?.classes as any)?.name || 'N/A', // Backward compat
          class_id: primaryClass?.class_id || '', // Backward compat
        };
      });

      setStudents(studentsWithClasses);
    } catch (error) {
      console.error('Error loading students:', error);
      alert('Lỗi khi tải danh sách học sinh');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    try {
      // Warn if changing primary class
      if (editingStudent && editingStudent.class_id &&
          editingStudent.class_id !== formData.primary_class_id) {
        const confirmed = confirm(
          'Bạn đang thay đổi lớp chính. Học phí cũ sẽ được giữ nguyên ở lớp cũ, ' +
          'học phí mới sẽ tạo ở lớp mới. Tiếp tục?'
        );
        if (!confirmed) return;
      }

      let studentId: string;

      if (editingStudent) {
        // UPDATE student info (not class_id - handled below via student_classes)
        const { error: updateError } = await supabase
          .from('students')
          .update({
            name: formData.name,
            phone: formData.phone,
            parent_phone: formData.parent_phone,
            note: formData.note,
          })
          .eq('id', editingStudent.id);

        if (updateError) throw updateError;
        studentId = editingStudent.id;
      } else {
        // CREATE student (without class_id - handled below)
        const { data: newStudent, error: insertError } = await supabase
          .from('students')
          .insert([{
            name: formData.name,
            phone: formData.phone,
            parent_phone: formData.parent_phone,
            note: formData.note,
          }])
          .select()
          .single();

        if (insertError) throw insertError;
        studentId = newStudent.id;
      }

      // DELETE old student_classes relationships
      await supabase
        .from('student_classes')
        .delete()
        .eq('student_id', studentId);

      // INSERT new relationships
      const classRelationships = [];

      // Primary class
      if (formData.primary_class_id) {
        classRelationships.push({
          student_id: studentId,
          class_id: formData.primary_class_id,
          is_primary: true,
        });
      }

      // Secondary classes
      formData.secondary_class_ids.forEach(classId => {
        classRelationships.push({
          student_id: studentId,
          class_id: classId,
          is_primary: false,
        });
      });

      if (classRelationships.length > 0) {
        const { error: scError } = await supabase
          .from('student_classes')
          .insert(classRelationships);

        if (scError) throw scError;
      }

      alert(editingStudent ? 'Cập nhật học sinh thành công!' : 'Thêm học sinh thành công!');
      closeModal();
      loadStudents();
    } catch (error) {
      console.error('Error saving student:', error);
      alert('Lỗi khi lưu học sinh');
    }
  }

  async function handleDelete(studentId: string, studentName: string) {
    if (!confirm(`Bạn có chắc muốn xóa học sinh "${studentName}"?\nLưu ý: Tất cả điểm danh và học phí liên quan sẽ bị xóa.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('students')
        .delete()
        .eq('id', studentId);

      if (error) throw error;
      alert('Xóa học sinh thành công!');
      loadStudents();
    } catch (error) {
      console.error('Error deleting student:', error);
      alert('Lỗi khi xóa học sinh');
    }
  }

  function openAddModal() {
    setEditingStudent(null);
    setFormData({
      name: '',
      phone: '',
      parent_phone: '',
      note: '',
      primary_class_id: '',
      secondary_class_ids: [],
    });
    setShowModal(true);
  }

  function openEditModal(student: StudentWithClasses) {
    setEditingStudent(student);
    setFormData({
      name: student.name,
      phone: student.phone,
      parent_phone: student.parent_phone,
      note: student.note,
      primary_class_id: student.class_id || '',
      secondary_class_ids: student.secondary_classes?.map(c => c.id) || [],
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingStudent(null);
    setFormData({
      name: '',
      phone: '',
      parent_phone: '',
      note: '',
      primary_class_id: '',
      secondary_class_ids: [],
    });
  }

  const filteredStudents = (() => {
    let result = students.filter(
      (s: any) => (s.primary_class as any)?.status !== 'locked'
    );
    if (filterClassId === 'on_leave') {
      result = result.filter(s => s.status === 'on_leave');
    } else if (filterClassId !== 'all') {
      result = result.filter(s => s.class_id === filterClassId);
    }
    return result;
  })();

  return (
    <div className="p-4 lg:p-8">
      {/* Header - Mobile: 3 rows, Desktop: 1 row */}
      <div className="mb-6 space-y-3 lg:space-y-0">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Quản lý Học sinh</h1>
        <p className="text-sm lg:text-base text-gray-600">Danh sách học sinh các lớp</p>
        <button
          onClick={openAddModal}
          className="w-full lg:w-auto flex items-center justify-center gap-2 px-4 lg:px-6 py-2 lg:py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-lg hover:shadow-xl text-sm lg:text-base"
        >
          <Plus size={18} />
          Thêm học sinh
        </button>
      </div>

      {/* Filter - Mobile: 3 rows, Desktop: 1 row */}
      <div className="mb-6 bg-white p-3 lg:p-4 rounded-lg shadow space-y-3 lg:space-y-0 lg:flex lg:items-center lg:gap-3">
        <div className="flex items-center gap-2 lg:gap-3">
          <Filter size={18} className="text-gray-600" />
          <label className="text-sm lg:text-base font-semibold text-gray-700">Lọc theo lớp:</label>
        </div>
        <select
          value={filterClassId}
          onChange={(e) => setFilterClassId(e.target.value)}
          className="w-full lg:w-auto px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
        >
          <option value="all">Tất cả lớp</option>
          <option value="on_leave">Đang tạm nghỉ</option>
          {classes.map((classItem) => (
            <option key={classItem.id} value={classItem.id}>
              {classItem.name}{classItem.status === 'locked' ? ' [Đã khóa]' : ''}
            </option>
          ))}
        </select>
        <span className="block lg:ml-auto text-gray-600 font-semibold text-sm lg:text-base">
          Tổng: {filteredStudents.length} học sinh
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500 text-lg">Chưa có học sinh nào</p>
          <p className="text-gray-400 mt-2">Nhấn "Thêm học sinh" để bắt đầu</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-2 lg:px-6 py-3 lg:py-4 text-left text-xs lg:text-sm font-bold text-gray-700">Họ tên</th>
                <th className="px-2 lg:px-6 py-3 lg:py-4 text-left text-xs lg:text-sm font-bold text-gray-700">Lớp</th>
                <th className="px-6 py-4 text-left text-sm font-bold text-gray-700 hidden lg:table-cell">SĐT học sinh</th>
                <th className="px-6 py-4 text-left text-sm font-bold text-gray-700 hidden lg:table-cell">SĐT phụ huynh</th>
                <th className="px-2 lg:px-6 py-3 lg:py-4 text-left text-xs lg:text-sm font-bold text-gray-700 hidden lg:table-cell">Ghi chú</th>
                <th className="px-2 lg:px-6 py-3 lg:py-4 text-center text-xs lg:text-sm font-bold text-gray-700">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredStudents.map((student) => (
                <tr key={student.id} className={`hover:bg-gray-50 transition-colors ${student.status === 'on_leave' ? 'bg-orange-50' : ''}`}>
                  <td className="px-2 lg:px-6 py-3 lg:py-4 text-xs lg:text-base whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${student.status === 'on_leave' ? 'text-gray-400' : 'text-gray-800'}`}>{student.name}</span>
                      {student.status === 'on_leave' && (
                        <span className="px-2 py-0.5 bg-orange-200 text-orange-700 text-xs rounded-full font-semibold whitespace-nowrap">Tạm nghỉ</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 lg:px-6 py-3 lg:py-4">
                    <div className="flex flex-wrap gap-1">
                      {student.primary_class && (
                        <span className="px-2 lg:px-3 py-1 bg-blue-600 text-white rounded-full text-xs font-semibold whitespace-nowrap">
                          {student.primary_class.name} (Chính)
                        </span>
                      )}
                      {student.secondary_classes && student.secondary_classes.length > 0 && student.secondary_classes.map((cls: any) => (
                        <span key={cls.id} className="px-2 lg:px-3 py-1 bg-gray-200 text-gray-700 rounded-full text-xs font-semibold whitespace-nowrap">
                          {cls.name}
                        </span>
                      ))}
                      {!student.primary_class && (!student.secondary_classes || student.secondary_classes.length === 0) && (
                        <span className="px-2 lg:px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-xs whitespace-nowrap">
                          N/A
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-600 hidden lg:table-cell">{student.phone || '-'}</td>
                  <td className="px-6 py-4 text-gray-600 hidden lg:table-cell">{student.parent_phone || '-'}</td>
                  <td className="px-6 py-4 text-gray-600 max-w-xs truncate hidden lg:table-cell">{student.note || '-'}</td>
                  <td className="px-2 lg:px-6 py-3 lg:py-4">
                    <div className="flex justify-center gap-1 lg:gap-2">
                      <button
                        onClick={() => openEditModal(student)}
                        className="p-1.5 lg:p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Sửa"
                      >
                        <Edit2 size={16} className="lg:w-[18px] lg:h-[18px]" />
                      </button>
                      <button
                        onClick={() => handleToggleLeave(student)}
                        className={`p-1.5 lg:p-2 rounded-lg transition-colors ${
                          student.status === 'on_leave'
                            ? 'text-green-600 hover:bg-green-50'
                            : 'text-orange-500 hover:bg-orange-50'
                        }`}
                        title={student.status === 'on_leave' ? 'Kích hoạt lại' : 'Chuyển tạm nghỉ'}
                      >
                        {student.status === 'on_leave'
                          ? <PlayCircle size={16} className="lg:w-[18px] lg:h-[18px]" />
                          : <PauseCircle size={16} className="lg:w-[18px] lg:h-[18px]" />
                        }
                      </button>
                      <button
                        onClick={() => handleDelete(student.id, student.name)}
                        className="p-1.5 lg:p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xóa"
                      >
                        <Trash2 size={16} className="lg:w-[18px] lg:h-[18px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-800">
                {editingStudent ? 'Sửa học sinh' : 'Thêm học sinh mới'}
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
                  Họ tên <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  placeholder="VD: Nguyễn Văn A"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Lớp chính <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={formData.primary_class_id}
                  onChange={(e) => {
                    const newPrimaryId = e.target.value;
                    setFormData({
                      ...formData,
                      primary_class_id: newPrimaryId,
                      // Remove from secondary if selected as primary
                      secondary_class_ids: formData.secondary_class_ids.filter(id => id !== newPrimaryId)
                    });
                  }}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                >
                  <option value="">-- Chọn lớp chính --</option>
                  {classes.map((classItem) => (
                    <option key={classItem.id} value={classItem.id}>
                      {classItem.name} ({classItem.subject})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Lớp chính sẽ xuất hiện trong quản lý học phí
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Lớp phụ (tùy chọn)
                </label>
                <div className="border-2 border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto bg-gray-50">
                  {classes
                    .filter(c => c.id !== formData.primary_class_id) // Don't show primary class
                    .map((classItem) => (
                      <label
                        key={classItem.id}
                        className="flex items-center gap-2 p-2 hover:bg-white rounded cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={formData.secondary_class_ids.includes(classItem.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                secondary_class_ids: [...formData.secondary_class_ids, classItem.id]
                              });
                            } else {
                              setFormData({
                                ...formData,
                                secondary_class_ids: formData.secondary_class_ids.filter(id => id !== classItem.id)
                              });
                            }
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">
                          {classItem.name} ({classItem.subject})
                        </span>
                      </label>
                    ))}
                  {classes.filter(c => c.id !== formData.primary_class_id).length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-4">
                      {formData.primary_class_id ? 'Không có lớp phụ khả dụng' : 'Vui lòng chọn lớp chính trước'}
                    </p>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Học sinh sẽ xuất hiện trong điểm danh của tất cả lớp được chọn
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  SĐT học sinh
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  placeholder="VD: 0912345678"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  SĐT phụ huynh
                </label>
                <input
                  type="tel"
                  value={formData.parent_phone}
                  onChange={(e) => setFormData({ ...formData, parent_phone: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  placeholder="VD: 0987654321"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Ghi chú
                </label>
                <textarea
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none resize-none"
                  placeholder="Ghi chú về học sinh (tùy chọn)"
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
                  {editingStudent ? 'Cập nhật' : 'Thêm học sinh'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

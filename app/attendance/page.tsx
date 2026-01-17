'use client';

import { useEffect, useState } from 'react';
import { supabase, Student, Class, Attendance } from '@/lib/supabase';
import { Save, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

interface AttendanceRecord {
  studentId: string;
  studentName: string;
  isAbsent: boolean; // true = vắng, false = có mặt
  note: string;
}

export default function AttendancePage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasExistingAttendance, setHasExistingAttendance] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (selectedClassId && selectedDate) {
      loadAttendance();
    }
  }, [selectedClassId, selectedDate]);

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

  async function loadAttendance() {
    try {
      setLoading(true);

      // Get students enrolled in this class (primary OR secondary)
      const { data: studentClassesData, error: scError } = await supabase
        .from('student_classes')
        .select(`
          student_id,
          is_primary,
          students (
            id,
            name
          )
        `)
        .eq('class_id', selectedClassId);

      if (scError) throw scError;

      // Get existing attendance records for this date
      const { data: existingAttendance, error: attendanceError } = await supabase
        .from('attendance')
        .select('*')
        .eq('class_id', selectedClassId)
        .eq('date', selectedDate);

      if (attendanceError) throw attendanceError;

      // Check if there's existing attendance for this date
      setHasExistingAttendance((existingAttendance?.length || 0) > 0);

      // Create attendance records array
      const records: AttendanceRecord[] = (studentClassesData || []).map((sc: any) => {
        const student = sc.students;
        const existing = existingAttendance?.find(a => a.student_id === student.id);
        return {
          studentId: student.id,
          studentName: student.name,
          isAbsent: existing?.status === 'absent', // true nếu vắng, false nếu có mặt
          note: existing?.note || '',
        };
      });

      setAttendanceRecords(records);
    } catch (error) {
      console.error('Error loading attendance:', error);
      alert('Lỗi khi tải điểm danh');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!selectedClassId || !selectedDate) {
      alert('Vui lòng chọn lớp và ngày');
      return;
    }

    try {
      setSaving(true);

      for (const record of attendanceRecords) {
        // Check if record exists
        const { data: existing } = await supabase
          .from('attendance')
          .select('id')
          .eq('student_id', record.studentId)
          .eq('class_id', selectedClassId)
          .eq('date', selectedDate)
          .single();

        const status = record.isAbsent ? 'absent' : 'present';

        if (existing) {
          // Update
          await supabase
            .from('attendance')
            .update({
              status: status,
              note: record.note,
            })
            .eq('id', existing.id);
        } else {
          // Insert
          await supabase
            .from('attendance')
            .insert([{
              student_id: record.studentId,
              class_id: selectedClassId,
              date: selectedDate,
              status: status,
              note: record.note,
            }]);
        }
      }

      alert('Lưu điểm danh thành công!');
      setHasExistingAttendance(true);
    } catch (error) {
      console.error('Error saving attendance:', error);
      alert('Lỗi khi lưu điểm danh');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAttendance() {
    if (!selectedClassId || !selectedDate) return;

    const confirmDelete = window.confirm(
      `Bạn có chắc muốn XÓA toàn bộ điểm danh ngày ${format(new Date(selectedDate), 'dd/MM/yyyy')}?\n\nHành động này không thể hoàn tác!`
    );

    if (!confirmDelete) return;

    try {
      setDeleting(true);

      const { error } = await supabase
        .from('attendance')
        .delete()
        .eq('class_id', selectedClassId)
        .eq('date', selectedDate);

      if (error) throw error;

      // Reset attendance records to default (all present)
      setAttendanceRecords(records =>
        records.map(r => ({ ...r, isAbsent: false, note: '' }))
      );
      setHasExistingAttendance(false);

      alert('Đã xóa điểm danh thành công!');
    } catch (error) {
      console.error('Error deleting attendance:', error);
      alert('Lỗi khi xóa điểm danh');
    } finally {
      setDeleting(false);
    }
  }

  function toggleAbsent(studentId: string) {
    setAttendanceRecords(records =>
      records.map(r =>
        r.studentId === studentId
          ? { ...r, isAbsent: !r.isAbsent }
          : r
      )
    );
  }

  const stats = {
    total: attendanceRecords.length,
    present: attendanceRecords.filter(r => !r.isAbsent).length,
    absent: attendanceRecords.filter(r => r.isAbsent).length,
  };

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-4 lg:mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Điểm danh</h1>
        <p className="text-sm lg:text-base text-gray-600 mt-1">Điểm danh học sinh theo buổi học</p>
      </div>

      {/* Controls */}
      <div className="bg-white p-4 lg:p-6 rounded-lg shadow mb-4 lg:mb-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
                    {classItem.name} - {classItem.subject}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Ngày <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full max-w-full min-w-0 px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !selectedClassId || attendanceRecords.length === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 lg:px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed text-sm lg:text-base"
            >
              <Save size={18} className="lg:w-5 lg:h-5" />
              {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
            {hasExistingAttendance && (
              <button
                onClick={handleDeleteAttendance}
                disabled={deleting}
                className="flex items-center justify-center gap-2 px-4 lg:px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed text-sm lg:text-base"
                title="Xóa điểm danh ngày này"
              >
                <Trash2 size={18} className="lg:w-5 lg:h-5" />
                {deleting ? '...' : 'Xóa'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats Table */}
      {attendanceRecords.length > 0 && (
        <div className="bg-white rounded-lg shadow mb-4 lg:mb-6 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-center text-xs lg:text-sm font-bold text-gray-700">Tổng số</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-center text-xs lg:text-sm font-bold text-gray-700">Có mặt</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-center text-xs lg:text-sm font-bold text-gray-700">Vắng</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="px-3 lg:px-6 py-3 lg:py-4 text-center">
                  <span className="text-xl lg:text-2xl font-bold text-gray-800">{stats.total}</span>
                </td>
                <td className="px-3 lg:px-6 py-3 lg:py-4 text-center">
                  <span className="text-xl lg:text-2xl font-bold text-green-600">{stats.present}</span>
                </td>
                <td className="px-3 lg:px-6 py-3 lg:py-4 text-center">
                  <span className="text-xl lg:text-2xl font-bold text-red-600">{stats.absent}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Attendance List */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : !selectedClassId ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500 text-sm lg:text-lg">Vui lòng chọn lớp để điểm danh</p>
        </div>
      ) : attendanceRecords.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500 text-sm lg:text-lg">Lớp này chưa có học sinh</p>
          <p className="text-gray-400 text-xs lg:text-base mt-2">Thêm học sinh trước khi điểm danh</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-2 lg:px-6 py-3 lg:py-4 text-left text-xs lg:text-sm font-bold text-gray-700">Họ và tên</th>
                <th className="px-2 lg:px-6 py-3 lg:py-4 text-center text-xs lg:text-sm font-bold text-gray-700 w-20 lg:w-32">Vắng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {attendanceRecords.map((record, index) => (
                <tr
                  key={record.studentId}
                  onClick={() => toggleAbsent(record.studentId)}
                  className="hover:bg-gray-50 transition-colors cursor-pointer active:bg-gray-100"
                >
                  <td className="px-2 lg:px-6 py-3 lg:py-4 text-xs lg:text-base font-semibold text-gray-800 whitespace-nowrap">
                    {index + 1}. {record.studentName}
                  </td>
                  <td className="px-2 lg:px-6 py-3 lg:py-4 text-center">
                    <input
                      type="checkbox"
                      checked={record.isAbsent}
                      onChange={() => {}}
                      className="w-5 h-5 lg:w-6 lg:h-6 text-red-600 border-gray-300 rounded focus:ring-red-500 pointer-events-none"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

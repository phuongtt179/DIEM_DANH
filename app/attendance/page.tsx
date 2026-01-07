'use client';

import { useEffect, useState } from 'react';
import { supabase, Student, Class, Attendance } from '@/lib/supabase';
import { Check, X, Clock, FileText, Save } from 'lucide-react';
import { format } from 'date-fns';

interface AttendanceRecord {
  studentId: string;
  studentName: string;
  status: 'present' | 'absent' | 'late' | 'excused' | '';
  note: string;
}

export default function AttendancePage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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

      // Get students in the class
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('*')
        .eq('class_id', selectedClassId)
        .order('name');

      if (studentsError) throw studentsError;

      // Get existing attendance records for this date
      const { data: existingAttendance, error: attendanceError } = await supabase
        .from('attendance')
        .select('*')
        .eq('class_id', selectedClassId)
        .eq('date', selectedDate);

      if (attendanceError) throw attendanceError;

      // Create attendance records array
      const records: AttendanceRecord[] = (students || []).map((student) => {
        const existing = existingAttendance?.find(a => a.student_id === student.id);
        return {
          studentId: student.id,
          studentName: student.name,
          status: existing?.status || 'present',
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

      // Filter only records with status
      const recordsToSave = attendanceRecords.filter(r => r.status);

      for (const record of recordsToSave) {
        // Check if record exists
        const { data: existing } = await supabase
          .from('attendance')
          .select('id')
          .eq('student_id', record.studentId)
          .eq('class_id', selectedClassId)
          .eq('date', selectedDate)
          .single();

        if (existing) {
          // Update
          await supabase
            .from('attendance')
            .update({
              status: record.status,
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
              status: record.status,
              note: record.note,
            }]);
        }
      }

      alert('Lưu điểm danh thành công!');
    } catch (error) {
      console.error('Error saving attendance:', error);
      alert('Lỗi khi lưu điểm danh');
    } finally {
      setSaving(false);
    }
  }

  function updateAttendance(studentId: string, field: 'status' | 'note', value: string) {
    setAttendanceRecords(records =>
      records.map(r =>
        r.studentId === studentId
          ? { ...r, [field]: value }
          : r
      )
    );
  }

  const statusButtons = [
    { value: 'present', label: 'Có mặt', icon: Check, color: 'bg-green-100 text-green-700 border-green-500' },
    { value: 'absent', label: 'Vắng', icon: X, color: 'bg-red-100 text-red-700 border-red-500' },
    { value: 'late', label: 'Muộn', icon: Clock, color: 'bg-yellow-100 text-yellow-700 border-yellow-500' },
    { value: 'excused', label: 'Có phép', icon: FileText, color: 'bg-blue-100 text-blue-700 border-blue-500' },
  ];

  const stats = {
    total: attendanceRecords.length,
    present: attendanceRecords.filter(r => r.status === 'present').length,
    absent: attendanceRecords.filter(r => r.status === 'absent').length,
    late: attendanceRecords.filter(r => r.status === 'late').length,
    excused: attendanceRecords.filter(r => r.status === 'excused').length,
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Điểm danh</h1>
        <p className="text-gray-600 mt-1">Điểm danh học sinh theo buổi học</p>
      </div>

      {/* Controls */}
      <div className="bg-white p-6 rounded-lg shadow mb-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Lớp <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
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
              className="w-full max-w-full min-w-0 px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleSave}
              disabled={saving || !selectedClassId || attendanceRecords.length === 0}
              className="w-full flex items-center justify-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              <Save size={20} />
              {saving ? 'Đang lưu...' : 'Lưu điểm danh'}
            </button>
          </div>
        </div>

        {/* Stats */}
        {attendanceRecords.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
              <p className="text-sm text-gray-600">Tổng số</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{stats.present}</p>
              <p className="text-sm text-gray-600">Có mặt</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{stats.absent}</p>
              <p className="text-sm text-gray-600">Vắng</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-600">{stats.late}</p>
              <p className="text-sm text-gray-600">Muộn</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{stats.excused}</p>
              <p className="text-sm text-gray-600">Có phép</p>
            </div>
          </div>
        )}
      </div>

      {/* Attendance List */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : !selectedClassId ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500 text-lg">Vui lòng chọn lớp để điểm danh</p>
        </div>
      ) : attendanceRecords.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500 text-lg">Lớp này chưa có học sinh</p>
          <p className="text-gray-400 mt-2">Thêm học sinh trước khi điểm danh</p>
        </div>
      ) : (
        <div className="space-y-4">
          {attendanceRecords.map((record, index) => (
            <div
              key={record.studentId}
              className="bg-white p-6 rounded-lg shadow hover:shadow-md transition-shadow"
            >
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-lg font-bold text-blue-600">{index + 1}</span>
                </div>

                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-800">{record.studentName}</h3>
                </div>

                <div className="flex flex-wrap gap-2">
                  {statusButtons.map((btn) => {
                    const Icon = btn.icon;
                    const isActive = record.status === btn.value;
                    return (
                      <button
                        key={btn.value}
                        onClick={() => updateAttendance(record.studentId, 'status', btn.value)}
                        className={`
                          flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all font-semibold
                          ${isActive
                            ? btn.color
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                          }
                        `}
                      >
                        <Icon size={18} />
                        {btn.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <input
                  type="text"
                  value={record.note}
                  onChange={(e) => updateAttendance(record.studentId, 'note', e.target.value)}
                  placeholder="Ghi chú (tùy chọn)"
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

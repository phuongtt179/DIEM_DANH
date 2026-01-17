'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ClipboardList, Check, X } from 'lucide-react';
import { format } from 'date-fns';

interface AttendanceRecord {
  date: string;
  status: 'present' | 'absent';
}

interface StudentAttendance {
  studentId: string;
  studentName: string;
  attendance: { [date: string]: 'present' | 'absent' };
  totalPresent: number;
  totalAbsent: number;
  isMultiClass: boolean;
  otherClasses?: string[];
}

interface MultiClassAttendance {
  studentId: string;
  studentName: string;
  // Combined attendance from ALL classes with class name
  attendance: { [date: string]: { status: 'present' | 'absent'; className: string } };
  dates: string[];
  totalPresent: number;
  totalAbsent: number;
}

export default function StatisticsPage() {
  const [studentAttendances, setStudentAttendances] = useState<StudentAttendance[]>([]);
  const [multiClassAttendances, setMultiClassAttendances] = useState<MultiClassAttendance[]>([]);
  const [classDates, setClassDates] = useState<string[]>([]);
  const [selectedStatClass, setSelectedStatClass] = useState<string>('');
  const [selectedStatMonth, setSelectedStatMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (selectedStatClass && selectedStatMonth) {
      loadAttendanceStats();
    }
  }, [selectedStatClass, selectedStatMonth]);

  async function loadClasses() {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('*')
        .order('name');

      if (error) throw error;
      setClasses(data || []);
      if (data && data.length > 0) {
        setSelectedStatClass(data[0].id);
      }
    } catch (error) {
      console.error('Error loading classes:', error);
    }
  }

  async function loadAttendanceStats() {
    try {
      setLoading(true);

      const [year, monthNum] = selectedStatMonth.split('-');
      const startDate = `${year}-${monthNum}-01`;
      const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
      const endDate = `${year}-${monthNum}-${String(lastDay).padStart(2, '0')}`;

      // Get all attendance records for this class in this month
      const { data: attendanceData, error: attError } = await supabase
        .from('attendance')
        .select('*')
        .eq('class_id', selectedStatClass)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date');

      if (attError) throw attError;

      // Get unique dates when class was held
      const uniqueDates = [...new Set(attendanceData?.map(a => a.date) || [])].sort();
      setClassDates(uniqueDates);

      // Get students in this class (primary)
      const { data: studentClassesData, error: scError } = await supabase
        .from('student_classes')
        .select(`
          student_id,
          students (
            id,
            name
          )
        `)
        .eq('class_id', selectedStatClass)
        .eq('is_primary', true);

      if (scError) throw scError;

      // Build attendance map for each student
      const studentStats: StudentAttendance[] = await Promise.all(
        (studentClassesData || []).map(async (sc: any) => {
          const student = sc.students;

          // Check if student has other classes
          const { data: otherClassesData } = await supabase
            .from('student_classes')
            .select(`
              class_id,
              classes (
                id,
                name
              )
            `)
            .eq('student_id', student.id)
            .neq('class_id', selectedStatClass);

          const isMultiClass = (otherClassesData?.length || 0) > 0;
          const otherClasses = otherClassesData?.map((oc: any) => oc.classes.name) || [];

          // Get attendance for this student in this class
          const studentAttendance = attendanceData?.filter(a => a.student_id === student.id) || [];

          const attendanceMap: { [date: string]: 'present' | 'absent' } = {};
          uniqueDates.forEach(date => {
            const record = studentAttendance.find(a => a.date === date);
            if (record) {
              attendanceMap[date] = record.status;
            }
          });

          const totalPresent = Object.values(attendanceMap).filter(s => s === 'present').length;
          const totalAbsent = Object.values(attendanceMap).filter(s => s === 'absent').length;

          return {
            studentId: student.id,
            studentName: student.name,
            attendance: attendanceMap,
            totalPresent,
            totalAbsent,
            isMultiClass,
            otherClasses,
          };
        })
      );

      setStudentAttendances(studentStats);

      // Load combined attendance from ALL classes for multi-class students
      const multiClassStudents = studentStats.filter(s => s.isMultiClass);
      const multiClassData: MultiClassAttendance[] = [];

      // Get selected class name
      const selectedClass = classes.find(c => c.id === selectedStatClass);
      const selectedClassName = selectedClass?.name || 'Lớp chính';

      for (const student of multiClassStudents) {
        const combinedAttendance: { [date: string]: { status: 'present' | 'absent'; className: string } } = {};

        // Add attendance from PRIMARY class (the one we're viewing)
        for (const date of Object.keys(student.attendance)) {
          combinedAttendance[date] = {
            status: student.attendance[date],
            className: selectedClassName,
          };
        }

        // Get ALL classes for this student (including other classes)
        const { data: allClassesData } = await supabase
          .from('student_classes')
          .select(`
            class_id,
            classes (
              id,
              name
            )
          `)
          .eq('student_id', student.studentId)
          .neq('class_id', selectedStatClass);

        // Get attendance from other classes
        for (const oc of allClassesData || []) {
          const { data: otherAttendance } = await supabase
            .from('attendance')
            .select('*')
            .eq('student_id', student.studentId)
            .eq('class_id', oc.class_id)
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date');

          if (otherAttendance && otherAttendance.length > 0) {
            for (const att of otherAttendance) {
              combinedAttendance[att.date] = {
                status: att.status,
                className: (oc as any).classes.name,
              };
            }
          }
        }

        // Sort all dates
        const allDates = Object.keys(combinedAttendance).sort();
        const totalPresent = Object.values(combinedAttendance).filter(a => a.status === 'present').length;
        const totalAbsent = Object.values(combinedAttendance).filter(a => a.status === 'absent').length;

        if (allDates.length > 0) {
          multiClassData.push({
            studentId: student.studentId,
            studentName: student.studentName,
            attendance: combinedAttendance,
            dates: allDates,
            totalPresent,
            totalAbsent,
          });
        }
      }

      setMultiClassAttendances(multiClassData);
    } catch (error) {
      console.error('Error loading attendance stats:', error);
    } finally {
      setLoading(false);
    }
  }

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'd/M');
  };

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 lg:mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Thống kê buổi học</h1>
        <p className="text-sm lg:text-base text-gray-600 mt-1">Theo dõi điểm danh chi tiết theo tháng</p>
      </div>

      <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6">
        <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-3 lg:mb-4 flex items-center gap-2">
          <ClipboardList className="text-blue-500" size={20} />
          Bảng điểm danh
        </h2>

        {/* Filters */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Lớp <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedStatClass}
              onChange={(e) => setSelectedStatClass(e.target.value)}
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
              Tháng <span className="text-red-500">*</span>
            </label>
            <input
              type="month"
              value={selectedStatMonth}
              onChange={(e) => setSelectedStatMonth(e.target.value)}
              className="w-full max-w-full min-w-0 px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
            />
          </div>
        </div>

        {/* Main Attendance Table */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : studentAttendances.length > 0 && classDates.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-bold text-gray-700 sticky left-0 bg-gray-50 z-10">STT</th>
                    <th className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-bold text-gray-700 sticky left-8 bg-gray-50 z-10 min-w-[120px]">Họ và tên</th>
                    {classDates.map(date => (
                      <th key={date} className="border border-gray-300 px-1 py-2 text-xs lg:text-sm font-bold text-gray-700 min-w-[45px]">
                        {formatDateHeader(date)}
                      </th>
                    ))}
                    <th className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-bold text-gray-700 bg-green-50">Có mặt</th>
                    <th className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-bold text-gray-700 bg-red-50">Vắng</th>
                  </tr>
                </thead>
                <tbody>
                  {studentAttendances
                    .filter(student => !student.isMultiClass) // Only show single-class students
                    .map((student, index) => (
                    <tr key={student.studentId} className="hover:bg-gray-50">
                      <td className="border border-gray-300 px-2 py-2 text-xs lg:text-sm text-center text-gray-600 sticky left-0 bg-white">{index + 1}</td>
                      <td className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-semibold text-gray-800 sticky left-8 bg-white">
                        {student.studentName}
                      </td>
                      {classDates.map(date => (
                        <td key={date} className="border border-gray-300 px-1 py-2 text-center">
                          {student.attendance[date] === 'present' ? (
                            <Check className="inline text-green-600" size={18} />
                          ) : student.attendance[date] === 'absent' ? (
                            <X className="inline text-red-600" size={18} />
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      ))}
                      <td className="border border-gray-300 px-2 py-2 text-xs lg:text-sm text-center font-bold text-green-600 bg-green-50">
                        {student.totalPresent}
                      </td>
                      <td className="border border-gray-300 px-2 py-2 text-xs lg:text-sm text-center font-bold text-red-600 bg-red-50">
                        {student.totalAbsent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <Check className="text-green-600" size={16} />
                <span>Có mặt</span>
              </div>
              <div className="flex items-center gap-1">
                <X className="text-red-600" size={16} />
                <span>Vắng mặt</span>
              </div>
            </div>

            {/* Multi-class students section - Combined attendance from ALL classes */}
            {multiClassAttendances.length > 0 && (
              <div className="mt-8 pt-6 border-t-2 border-gray-200">
                <h3 className="text-lg font-bold text-gray-800 mb-4">
                  Tổng hợp điểm danh (học sinh học nhiều lớp)
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Bảng này hiển thị tất cả các buổi học từ mọi lớp của học sinh
                </p>

                {/* Get all unique dates across all multi-class students */}
                {(() => {
                  const allDates = [...new Set(multiClassAttendances.flatMap(s => s.dates))].sort();

                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-bold text-gray-700">STT</th>
                            <th className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-bold text-gray-700 min-w-[120px]">Họ và tên</th>
                            {allDates.map(date => (
                              <th key={date} className="border border-gray-300 px-1 py-2 text-xs lg:text-sm font-bold text-gray-700 min-w-[45px]">
                                {formatDateHeader(date)}
                              </th>
                            ))}
                            <th className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-bold text-gray-700 bg-green-50">Có mặt</th>
                            <th className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-bold text-gray-700 bg-red-50">Vắng</th>
                          </tr>
                        </thead>
                        <tbody>
                          {multiClassAttendances.map((student, index) => (
                            <tr key={student.studentId} className="hover:bg-gray-50">
                              <td className="border border-gray-300 px-2 py-2 text-xs lg:text-sm text-center text-gray-600">{index + 1}</td>
                              <td className="border border-gray-300 px-2 py-2 text-xs lg:text-sm font-semibold text-gray-800">
                                {student.studentName}
                              </td>
                              {allDates.map(date => {
                                const att = student.attendance[date];
                                return (
                                  <td key={date} className="border border-gray-300 px-1 py-2 text-center" title={att?.className}>
                                    {att?.status === 'present' ? (
                                      <Check className="inline text-green-600" size={18} />
                                    ) : att?.status === 'absent' ? (
                                      <X className="inline text-red-600" size={18} />
                                    ) : (
                                      <span className="text-gray-300">-</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="border border-gray-300 px-2 py-2 text-xs lg:text-sm text-center font-bold text-green-600 bg-green-50">
                                {student.totalPresent}
                              </td>
                              <td className="border border-gray-300 px-2 py-2 text-xs lg:text-sm text-center font-bold text-red-600 bg-red-50">
                                {student.totalAbsent}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-gray-500">
            {classes.length === 0 ? 'Chưa có lớp học' : classDates.length === 0 ? 'Chưa có buổi học nào trong tháng này' : 'Không có dữ liệu'}
          </div>
        )}
      </div>
    </div>
  );
}

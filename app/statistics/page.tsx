'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ClipboardList } from 'lucide-react';
import { format } from 'date-fns';

interface SessionStat {
  studentName: string;
  sessions: number;
  tuition: number;
  paidDate: string | null;
  status: 'paid' | 'unpaid';
}

export default function StatisticsPage() {
  const [sessionStats, setSessionStats] = useState<SessionStat[]>([]);
  const [selectedStatClass, setSelectedStatClass] = useState<string>('');
  const [selectedStatMonth, setSelectedStatMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (selectedStatClass && selectedStatMonth) {
      loadSessionStats();
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

  async function loadSessionStats() {
    try {
      setLoading(true);

      // Get students in primary class
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

      // Get class tuition
      const { data: classData } = await supabase
        .from('classes')
        .select('tuition')
        .eq('id', selectedStatClass)
        .single();

      // Get payments for this month
      const { data: paymentsData } = await supabase
        .from('payments')
        .select('*')
        .eq('class_id', selectedStatClass)
        .eq('month', selectedStatMonth);

      // Calculate sessions for each student
      const [year, monthNum] = selectedStatMonth.split('-');
      const startDate = `${year}-${monthNum}-01`;
      const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
      const endDate = `${year}-${monthNum}-${String(lastDay).padStart(2, '0')}`;

      const stats: SessionStat[] = await Promise.all(
        (studentClassesData || []).map(async (sc: any) => {
          const student = sc.students;

          // Get ALL classes for this student
          const { data: allClasses } = await supabase
            .from('student_classes')
            .select('class_id')
            .eq('student_id', student.id);

          const classIds = allClasses?.map((c: any) => c.class_id) || [];

          // Count attendance across ALL classes
          const { data: attendanceData } = await supabase
            .from('attendance')
            .select('id')
            .eq('student_id', student.id)
            .in('class_id', classIds)
            .gte('date', startDate)
            .lte('date', endDate)
            .eq('status', 'present');

          const sessions = attendanceData?.length || 0;

          // Get payment info
          const payment = paymentsData?.find((p: any) => p.student_id === student.id);

          return {
            studentName: student.name,
            sessions: sessions,
            tuition: payment?.amount || classData?.tuition || 0,
            paidDate: payment?.paid_date || null,
            status: payment?.status || 'unpaid',
          };
        })
      );

      setSessionStats(stats);
    } catch (error) {
      console.error('Error loading session stats:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 lg:mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Thống kê buổi học</h1>
        <p className="text-sm lg:text-base text-gray-600 mt-1">Theo dõi số buổi học và học phí theo tháng</p>
      </div>

      <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6">
        <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-3 lg:mb-4 flex items-center gap-2">
          <ClipboardList className="text-blue-500" size={20} />
          Thống kê chi tiết
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

        {/* Table */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : sessionStats.length > 0 ? (
          <div className="overflow-x-auto">
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
                {sessionStats.map((stat, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-gray-600">{index + 1}</td>
                    <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base font-semibold text-gray-800">{stat.studentName}</td>
                    <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-center text-gray-600">{stat.sessions} buổi</td>
                    <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-right font-semibold text-gray-800">
                      {stat.tuition.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-center">
                      {stat.paidDate ? (
                        <span className="text-green-600 font-semibold">
                          {format(new Date(stat.paidDate), 'dd/MM/yyyy')}
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
        ) : (
          <div className="text-center py-12 text-gray-500">
            {classes.length === 0 ? 'Chưa có lớp học' : 'Không có dữ liệu'}
          </div>
        )}
      </div>
    </div>
  );
}

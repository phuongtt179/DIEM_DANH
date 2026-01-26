'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BookOpen, Users, ClipboardList, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

interface Stats {
  totalClasses: number;
  totalStudents: number;
  todayAttendance: {
    present: number;
    total: number;
  };
  currentMonthPayments: {
    paid: number;
    unpaid: number;
    totalAmount: number;
    paidAmount: number;
  };
  recentActivity: {
    type: 'class' | 'student' | 'attendance' | 'payment';
    message: string;
    date: string;
  }[];
}

interface TodayPayment {
  studentName: string;
  className: string;
  amount: number;
}

interface DebtRecord {
  studentName: string;
  className: string;
  month: string;
  amount: number;
}

interface YearlyRevenue {
  year: string;
  totalAmount: number;
  monthlyBreakdown: { month: string; amount: number }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalClasses: 0,
    totalStudents: 0,
    todayAttendance: { present: 0, total: 0 },
    currentMonthPayments: { paid: 0, unpaid: 0, totalAmount: 0, paidAmount: 0 },
    recentActivity: [],
  });
  const [loading, setLoading] = useState(true);
  const [todayPayments, setTodayPayments] = useState<TodayPayment[]>([]);
  const [debtRecords, setDebtRecords] = useState<DebtRecord[]>([]);
  const [yearlyRevenue, setYearlyRevenue] = useState<YearlyRevenue[]>([]);

  useEffect(() => {
    loadStats();
    loadTodayPayments();
    loadDebtRecords();
    loadYearlyRevenue();
  }, []);

  async function loadStats() {
    try {
      setLoading(true);

      // Total classes
      const { count: classesCount } = await supabase
        .from('classes')
        .select('*', { count: 'exact', head: true });

      // Total students
      const { count: studentsCount } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true });

      // Today's attendance
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data: todayAttendance } = await supabase
        .from('attendance')
        .select('status')
        .eq('date', today);

      const presentToday = todayAttendance?.filter(a => a.status === 'present').length || 0;
      const totalToday = todayAttendance?.length || 0;

      // Current month payments
      const currentMonth = format(new Date(), 'yyyy-MM');
      const { data: payments } = await supabase
        .from('payments')
        .select('status, amount')
        .eq('month', currentMonth);

      const paidPayments = payments?.filter(p => p.status === 'paid') || [];
      const paidAmount = paidPayments.reduce((sum, p) => sum + p.amount, 0);

      // Calculate total expected amount based on all students and their class tuition
      const { data: studentsWithClasses } = await supabase
        .from('students')
        .select(`
          id,
          classes!students_class_id_fkey (
            tuition
          )
        `);

      const totalExpectedAmount = (studentsWithClasses || []).reduce((sum, student: any) => {
        const tuition = student.classes?.tuition || 0;
        return sum + tuition;
      }, 0);

      // Calculate unpaid based on total students vs paid count
      const totalStudents = studentsCount || 0;
      const paidCount = paidPayments.length;
      const unpaidCount = totalStudents - paidCount;

      setStats({
        totalClasses: classesCount || 0,
        totalStudents: studentsCount || 0,
        todayAttendance: {
          present: presentToday,
          total: totalToday,
        },
        currentMonthPayments: {
          paid: paidCount,
          unpaid: unpaidCount,
          totalAmount: totalExpectedAmount,
          paidAmount,
        },
        recentActivity: [],
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadTodayPayments() {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');

      const { data, error } = await supabase
        .from('payments')
        .select(`
          amount,
          students (
            name
          ),
          classes (
            name
          )
        `)
        .eq('paid_date', today)
        .eq('status', 'paid');

      if (error) throw error;

      const payments: TodayPayment[] = (data || []).map((p: any) => ({
        studentName: p.students?.name || 'N/A',
        className: p.classes?.name || 'N/A',
        amount: p.amount,
      }));

      setTodayPayments(payments);
    } catch (error) {
      console.error('Error loading today payments:', error);
    }
  }

  async function loadDebtRecords() {
    try {
      const currentMonth = format(new Date(), 'yyyy-MM');

      // Get all unpaid payments from previous months (starting from 2026-01)
      const { data, error } = await supabase
        .from('payments')
        .select(`
          month,
          amount,
          students (
            name
          ),
          classes (
            name
          )
        `)
        .eq('status', 'unpaid')
        .gte('month', '2026-01')
        .lt('month', currentMonth)
        .order('month', { ascending: false });

      if (error) throw error;

      const debts: DebtRecord[] = (data || []).map((p: any) => ({
        studentName: p.students?.name || 'N/A',
        className: p.classes?.name || 'N/A',
        month: p.month,
        amount: p.amount,
      }));

      setDebtRecords(debts);
    } catch (error) {
      console.error('Error loading debt records:', error);
    }
  }

  async function loadYearlyRevenue() {
    try {
      // Get all paid payments from 2026 onwards
      const { data, error } = await supabase
        .from('payments')
        .select('month, amount')
        .eq('status', 'paid')
        .gte('month', '2026-01')
        .order('month', { ascending: true });

      if (error) throw error;

      // Group by year
      const yearlyMap: { [year: string]: { total: number; months: { [month: string]: number } } } = {};

      (data || []).forEach((p: any) => {
        const year = p.month.split('-')[0];
        const month = p.month;

        if (!yearlyMap[year]) {
          yearlyMap[year] = { total: 0, months: {} };
        }

        yearlyMap[year].total += p.amount;

        if (!yearlyMap[year].months[month]) {
          yearlyMap[year].months[month] = 0;
        }
        yearlyMap[year].months[month] += p.amount;
      });

      // Convert to array
      const revenues: YearlyRevenue[] = Object.entries(yearlyMap).map(([year, data]) => ({
        year,
        totalAmount: data.total,
        monthlyBreakdown: Object.entries(data.months)
          .map(([month, amount]) => ({ month, amount }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      })).sort((a, b) => b.year.localeCompare(a.year)); // Newest year first

      setYearlyRevenue(revenues);
    } catch (error) {
      console.error('Error loading yearly revenue:', error);
    }
  }

  const statCards = [
    {
      title: 'Tổng số lớp',
      value: stats.totalClasses,
      icon: BookOpen,
      color: 'bg-blue-500',
      link: '/classes',
    },
    {
      title: 'Tổng số học sinh',
      value: stats.totalStudents,
      icon: Users,
      color: 'bg-green-500',
      link: '/students',
    },
    {
      title: 'Điểm danh hôm nay',
      value: `${stats.todayAttendance.present}/${stats.todayAttendance.total}`,
      icon: ClipboardList,
      color: 'bg-yellow-500',
      link: '/attendance',
    },
    {
      title: 'Học phí tháng này',
      value: `${stats.currentMonthPayments.paid}/${stats.currentMonthPayments.paid + stats.currentMonthPayments.unpaid}`,
      icon: DollarSign,
      color: 'bg-purple-500',
      link: '/payments',
    },
  ];

  const attendancePercentage = stats.todayAttendance.total > 0
    ? Math.round((stats.todayAttendance.present / stats.todayAttendance.total) * 100)
    : 0;

  const paymentPercentage = (stats.currentMonthPayments.paid + stats.currentMonthPayments.unpaid) > 0
    ? Math.round((stats.currentMonthPayments.paid / (stats.currentMonthPayments.paid + stats.currentMonthPayments.unpaid)) * 100)
    : 0;

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 lg:mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Tổng quan</h1>
        <p className="text-sm lg:text-base text-gray-600 mt-1">Dashboard quản lý lớp học & điểm danh</p>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-6 mb-6 lg:mb-8">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.title}
                  href={card.link}
                  className="bg-white rounded-lg lg:rounded-xl shadow-md hover:shadow-xl transition-all p-3 lg:p-6 border-2 border-transparent hover:border-blue-400"
                >
                  <div className="flex items-center justify-between mb-2 lg:mb-4">
                    <div className={`${card.color} w-8 h-8 lg:w-12 lg:h-12 rounded-lg flex items-center justify-center`}>
                      <Icon className="text-white w-4 h-4 lg:w-6 lg:h-6" />
                    </div>
                  </div>
                  <h3 className="text-gray-600 text-xs lg:text-sm font-semibold mb-1">{card.title}</h3>
                  <p className="text-xl lg:text-3xl font-bold text-gray-800">{card.value}</p>
                </Link>
              );
            })}
          </div>

          {/* Today's Payments */}
          {todayPayments.length > 0 && (
            <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6 mb-6 lg:mb-8">
              <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-3 lg:mb-4 flex items-center gap-2">
                <DollarSign className="text-green-500" size={20} />
                Học phí hôm nay ({format(new Date(), 'dd/MM/yyyy')})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b-2 border-gray-200">
                    <tr>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">STT</th>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">Tên học sinh</th>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">Lớp</th>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-right text-xs lg:text-sm font-bold text-gray-700">Số tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {todayPayments.map((payment, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-gray-600">{index + 1}</td>
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base font-semibold text-gray-800">{payment.studentName}</td>
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-gray-600">{payment.className}</td>
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-right font-semibold text-green-600">
                          {payment.amount.toLocaleString('vi-VN')} đ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td colSpan={3} className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-sm font-bold text-gray-700 text-right">
                        Tổng cộng:
                      </td>
                      <td className="px-3 lg:px-6 py-2 lg:py-3 text-right font-bold text-green-600">
                        {todayPayments.reduce((sum, p) => sum + p.amount, 0).toLocaleString('vi-VN')} đ
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Payment Stats */}
          <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6 mb-6 lg:mb-8">
            <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-3 lg:mb-4 flex items-center gap-2">
              <DollarSign className="text-purple-500" size={20} />
              Học phí tháng {format(new Date(), 'MM/yyyy')}
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Đã đóng:</span>
                <span className="text-2xl font-bold text-green-600">{stats.currentMonthPayments.paid}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Chưa đóng:</span>
                <span className="text-2xl font-bold text-red-600">{stats.currentMonthPayments.unpaid}</span>
              </div>
              <div className="pt-4 border-t">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-600 font-semibold">Đã thu:</span>
                  <span className="text-lg font-bold text-green-600">
                    {stats.currentMonthPayments.paidAmount.toLocaleString('vi-VN')} đ
                  </span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-600 font-semibold">Tổng dự kiến:</span>
                  <span className="text-lg font-bold text-gray-800">
                    {stats.currentMonthPayments.totalAmount.toLocaleString('vi-VN')} đ
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 mt-3">
                  <div
                    className="bg-gradient-to-r from-purple-400 to-purple-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${paymentPercentage}%` }}
                  ></div>
                </div>
                <p className="text-center mt-2 text-sm text-gray-600">
                  {paymentPercentage}% đã thu
                </p>
              </div>
            </div>
          </div>

          {/* Yearly Revenue */}
          {yearlyRevenue.length > 0 && (
            <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6 mb-6 lg:mb-8 border-l-4 border-green-500">
              <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-3 lg:mb-4 flex items-center gap-2">
                <TrendingUp className="text-green-500" size={20} />
                Tổng doanh thu theo năm
              </h2>
              <div className="space-y-4">
                {yearlyRevenue.map((yearData) => (
                  <div key={yearData.year} className="border rounded-lg p-4">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-lg font-bold text-gray-800">Năm {yearData.year}</span>
                      <span className="text-xl font-bold text-green-600">
                        {yearData.totalAmount.toLocaleString('vi-VN')} đ
                      </span>
                    </div>
                    <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
                      {yearData.monthlyBreakdown.map((m) => (
                        <div key={m.month} className="bg-green-50 rounded p-2 text-center">
                          <p className="text-xs text-gray-600">T{m.month.split('-')[1]}</p>
                          <p className="text-sm font-semibold text-green-600">
                            {(m.amount / 1000000).toFixed(1)}tr
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Debt Records - Students with unpaid fees from previous months */}
          {debtRecords.length > 0 && (
            <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6 mb-6 lg:mb-8 border-l-4 border-red-500">
              <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-3 lg:mb-4 flex items-center gap-2">
                <TrendingDown className="text-red-500" size={20} />
                Nợ học phí ({debtRecords.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-red-50 border-b-2 border-red-200">
                    <tr>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">STT</th>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">Tên học sinh</th>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">Lớp</th>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-center text-xs lg:text-sm font-bold text-gray-700">Tháng</th>
                      <th className="px-3 lg:px-6 py-2 lg:py-3 text-right text-xs lg:text-sm font-bold text-gray-700">Số tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {debtRecords.map((debt, index) => (
                      <tr key={index} className="hover:bg-red-50">
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-gray-600">{index + 1}</td>
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base font-semibold text-gray-800">{debt.studentName}</td>
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-gray-600">{debt.className}</td>
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-center text-gray-600">
                          {debt.month.split('-')[1]}/{debt.month.split('-')[0]}
                        </td>
                        <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-right font-semibold text-red-600">
                          {debt.amount.toLocaleString('vi-VN')} đ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-red-50 border-t-2 border-red-200">
                    <tr>
                      <td colSpan={4} className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-sm font-bold text-gray-700 text-right">
                        Tổng nợ:
                      </td>
                      <td className="px-3 lg:px-6 py-2 lg:py-3 text-right font-bold text-red-600">
                        {debtRecords.reduce((sum, d) => sum + d.amount, 0).toLocaleString('vi-VN')} đ
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Welcome Message */}
          {stats.totalClasses === 0 && (
            <div className="mt-8 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl shadow-lg p-8 text-white">
              <h2 className="text-2xl font-bold mb-2">Chào mừng đến với Hệ thống Quản lý Lớp học! 🎓</h2>
              <p className="mb-4">Để bắt đầu, hãy thêm lớp học đầu tiên của bạn.</p>
              <Link
                href="/classes"
                className="inline-block px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition-colors"
              >
                Thêm lớp học ngay
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalClasses: 0,
    totalStudents: 0,
    todayAttendance: { present: 0, total: 0 },
    currentMonthPayments: { paid: 0, unpaid: 0, totalAmount: 0, paidAmount: 0 },
    recentActivity: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
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

          {/* Detailed Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 mb-6 lg:mb-8">
            {/* Attendance Stats */}
            <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6">
              <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-3 lg:mb-4 flex items-center gap-2">
                <ClipboardList className="text-yellow-500" size={20} />
                Điểm danh hôm nay
              </h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Có mặt:</span>
                  <span className="text-2xl font-bold text-green-600">{stats.todayAttendance.present}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Tổng số:</span>
                  <span className="text-2xl font-bold text-gray-800">{stats.todayAttendance.total}</span>
                </div>
                <div className="pt-4 border-t">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-600 font-semibold">Tỷ lệ:</span>
                    <span className="text-xl font-bold text-blue-600">{attendancePercentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-green-400 to-green-600 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${attendancePercentage}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Stats */}
            <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6">
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
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-lg lg:rounded-xl shadow-md p-4 lg:p-6">
            <h2 className="text-lg lg:text-xl font-bold text-gray-800 mb-3 lg:mb-4">Thao tác nhanh</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
              <Link
                href="/classes"
                className="flex flex-col lg:flex-row items-center gap-2 lg:gap-3 p-3 lg:p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                <BookOpen className="text-blue-600" size={20} />
                <span className="text-xs lg:text-sm font-semibold text-gray-800 text-center lg:text-left">Quản lý lớp học</span>
              </Link>
              <Link
                href="/students"
                className="flex flex-col lg:flex-row items-center gap-2 lg:gap-3 p-3 lg:p-4 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
              >
                <Users className="text-green-600" size={20} />
                <span className="text-xs lg:text-sm font-semibold text-gray-800 text-center lg:text-left">Quản lý học sinh</span>
              </Link>
              <Link
                href="/attendance"
                className="flex flex-col lg:flex-row items-center gap-2 lg:gap-3 p-3 lg:p-4 bg-yellow-50 hover:bg-yellow-100 rounded-lg transition-colors"
              >
                <ClipboardList className="text-yellow-600" size={20} />
                <span className="text-xs lg:text-sm font-semibold text-gray-800 text-center lg:text-left">Điểm danh</span>
              </Link>
              <Link
                href="/payments"
                className="flex flex-col lg:flex-row items-center gap-2 lg:gap-3 p-3 lg:p-4 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
              >
                <DollarSign className="text-purple-600" size={20} />
                <span className="text-xs lg:text-sm font-semibold text-gray-800 text-center lg:text-left">Quản lý học phí</span>
              </Link>
            </div>
          </div>

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

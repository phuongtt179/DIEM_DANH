'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Home,
  BookOpen,
  Users,
  ClipboardList,
  DollarSign,
  BarChart3,
  ExternalLink,
  Menu,
  X,
  LogOut,
  UserCog,
  User,
  GraduationCap,
  Bot
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const allNavItems = [
  { href: '/', icon: Home, label: 'Tổng quan', permission: 'view_dashboard' },
  { href: '/classes', icon: BookOpen, label: 'Lớp học', permission: 'manage_classes' },
  { href: '/students', icon: Users, label: 'Học sinh', permission: 'manage_students' },
  { href: '/attendance', icon: ClipboardList, label: 'Điểm danh', permission: 'view_attendance' },
  { href: '/payments', icon: DollarSign, label: 'Học phí', permission: 'manage_payments' },
  { href: '/statistics', icon: BarChart3, label: 'Thống kê', permission: 'view_statistics' },
  { href: '/assistants', icon: GraduationCap, label: 'Trợ giảng', permission: 'manage_assistants' },
  { href: '/chat', icon: Bot, label: 'Trợ lý AI', permission: 'use_ai_chat' },
  { href: '/users', icon: UserCog, label: 'Người dùng', permission: 'manage_users' },
];

const roleLabels: { [key: string]: string } = {
  admin: 'Quản trị viên',
  teacher: 'Giáo viên',
  treasurer: 'Thủ quỹ',
};

export default function Sidebar() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, logout, hasPermission } = useAuth();

  const navItems = allNavItems.filter(item => hasPermission(item.permission));

  // Vuốt từ MÉP PHẢI để mở sidebar (mobile). Vuốt sang phải trên drawer để đóng.
  useEffect(() => {
    let startX = 0, startY = 0, fromRightEdge = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      fromRightEdge = t.clientX > window.innerWidth - 28;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dy > 60) return; // bỏ qua nếu vuốt dọc
      if (fromRightEdge && dx < -50) setIsMobileMenuOpen(true);   // vuốt trái từ mép phải → mở
      else if (dx > 60) setIsMobileMenuOpen(false);              // vuốt phải → đóng
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, []);

  return (
    <>
      {/* Tab mảnh ở mép phải (mobile) — gợi ý + bấm mở nhanh */}
      {!isMobileMenuOpen && (
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          aria-label="Mở menu"
          className="lg:hidden fixed z-30 top-1/2 -translate-y-1/2 right-0 w-1.5 h-16 rounded-l-full bg-blue-600/60 active:bg-blue-600"
        />
      )}

      {/* Lớp phủ khi mở drawer (mobile) */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar: desktop cố định bên trái; mobile là drawer trượt từ PHẢI */}
      <aside
        className={`
          fixed lg:static inset-y-0 right-0 lg:right-auto lg:left-0 z-50
          w-64 bg-gradient-to-b from-blue-600 to-blue-700 text-white flex flex-col
          transform transition-transform duration-300 ease-in-out
          lg:transform-none
          ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:translate-x-0
        `}
      >
        <div className="p-6 hidden lg:block">
          <h1 className="text-2xl font-bold">Quản lý Lớp học</h1>
          <p className="text-blue-100 text-sm mt-1">Điểm danh & Học phí</p>
        </div>

        {/* Đầu drawer trên mobile: tên + nút đóng */}
        <div className="p-5 lg:hidden flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate">{user?.name}</h1>
            <p className="text-blue-100 text-xs">{roleLabels[user?.role || '']}</p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Đóng menu"
            className="p-2 hover:bg-white/10 rounded-lg shrink-0"
          >
            <X size={22} />
          </button>
        </div>

        <nav className="flex-1 px-3 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 mb-1 rounded-lg
                  transition-all duration-200
                  ${isActive
                    ? 'bg-white/20 text-white font-semibold border-l-4 border-white'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white border-l-4 border-transparent'
                  }
                `}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-blue-500">
          <div className="flex items-center gap-3 px-4 py-2 mb-2">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
              <User size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{user?.name}</p>
              <p className="text-xs text-blue-200">{roleLabels[user?.role || '']}</p>
            </div>
          </div>

          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-4 py-2 text-blue-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <LogOut size={18} />
            <span className="text-sm">Đăng xuất</span>
          </button>
        </div>
      </aside>
    </>
  );
}

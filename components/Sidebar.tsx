'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
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
  User
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const allNavItems = [
  { href: '/', icon: Home, label: 'Tổng quan', permission: 'view_dashboard' },
  { href: '/classes', icon: BookOpen, label: 'Lớp học', permission: 'manage_classes' },
  { href: '/students', icon: Users, label: 'Học sinh', permission: 'manage_students' },
  { href: '/attendance', icon: ClipboardList, label: 'Điểm danh', permission: 'view_attendance' },
  { href: '/payments', icon: DollarSign, label: 'Học phí', permission: 'manage_payments' },
  { href: '/statistics', icon: BarChart3, label: 'Thống kê', permission: 'view_statistics' },
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

  // Filter nav items based on permissions
  const navItems = allNavItems.filter(item => hasPermission(item.permission));

  // Mobile nav items - filter and limit to 4
  const mobileNavItems = navItems
    .filter(item => ['/', '/attendance', '/payments', '/statistics'].includes(item.href))
    .slice(0, 4);

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <div>
          <h1 className="text-lg font-bold">Quản lý Lớp học</h1>
          <p className="text-blue-100 text-xs">{user?.name} - {roleLabels[user?.role || '']}</p>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Desktop Sidebar & Mobile Drawer */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          w-64 bg-gradient-to-b from-blue-600 to-blue-700 text-white flex flex-col
          transform transition-transform duration-300 ease-in-out
          lg:transform-none
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        <div className="p-6 lg:block hidden">
          <h1 className="text-2xl font-bold">Quản lý Lớp học</h1>
          <p className="text-blue-100 text-sm mt-1">Điểm danh & Học phí</p>
        </div>

        <div className="p-6 lg:hidden">
          <h1 className="text-xl font-bold">Menu</h1>
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
          {/* User info */}
          <div className="flex items-center gap-3 px-4 py-2 mb-2">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
              <User size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{user?.name}</p>
              <p className="text-xs text-blue-200">{roleLabels[user?.role || '']}</p>
            </div>
          </div>

          {/* Logout button */}
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-4 py-2 text-blue-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <LogOut size={18} />
            <span className="text-sm">Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-lg">
        <div className="grid grid-cols-4 gap-1">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex flex-col items-center justify-center py-2 px-1
                  transition-colors
                  ${isActive
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:bg-gray-50'
                  }
                `}
              >
                <Icon size={20} />
                <span className="text-xs mt-1 font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

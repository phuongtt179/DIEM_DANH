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
  X
} from 'lucide-react';

const navItems = [
  { href: '/', icon: Home, label: 'Tổng quan' },
  { href: '/classes', icon: BookOpen, label: 'Lớp học' },
  { href: '/students', icon: Users, label: 'Học sinh' },
  { href: '/attendance', icon: ClipboardList, label: 'Điểm danh' },
  { href: '/payments', icon: DollarSign, label: 'Học phí' },
  { href: '/statistics', icon: BarChart3, label: 'Thống kê' },
];

// Mobile bottom navigation - only show 4 items
const mobileNavItems = [
  { href: '/', icon: Home, label: 'Tổng quan' },
  { href: '/attendance', icon: ClipboardList, label: 'Điểm danh' },
  { href: '/payments', icon: DollarSign, label: 'Học phí' },
  { href: '/statistics', icon: BarChart3, label: 'Thống kê' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <div>
          <h1 className="text-lg font-bold">Quản lý Lớp học</h1>
          <p className="text-blue-100 text-xs">Điểm danh & Học phí</p>
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
          <a
            href={process.env.NEXT_PUBLIC_SUPABASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-blue-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ExternalLink size={18} />
            <span className="text-sm">Mở Supabase</span>
          </a>
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

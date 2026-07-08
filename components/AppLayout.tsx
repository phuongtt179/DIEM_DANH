'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import Sidebar from '@/components/Sidebar';
import ChatWidget from '@/components/ChatWidget';

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && pathname !== '/login') {
      router.push('/login');
    }
  }, [user, loading, pathname, router]);

  // Khi MỞ app trên điện thoại: vào thẳng khung chat (chỉ 1 lần mỗi phiên mở app).
  // Sau đó vẫn vào Dashboard/các trang khác qua menu bình thường.
  useEffect(() => {
    if (loading || !user) return;
    if (sessionStorage.getItem('app_launched')) return;
    sessionStorage.setItem('app_launched', '1');
    if (window.innerWidth < 1024 && pathname === '/') {
      router.replace('/chat');
    }
  }, [loading, user, pathname, router]);

  // Show loading while checking auth
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Login page - no sidebar
  if (pathname === '/login') {
    return <>{children}</>;
  }

  // Not logged in - show nothing (will redirect)
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Logged in - show sidebar and content
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <ChatWidget />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <LayoutContent>{children}</LayoutContent>
    </AuthProvider>
  );
}

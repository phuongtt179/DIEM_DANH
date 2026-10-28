'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher' | 'treasurer' | 'planner';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Define permissions for each role
const rolePermissions: { [role: string]: string[] } = {
  admin: [
    'view_dashboard',
    'manage_classes',
    'manage_students',
    'take_attendance',
    'view_attendance',
    'view_statistics',
    'manage_payments',
    'manage_users',
    'manage_assistants',
    'use_ai_chat',
    'use_work',
  ],
  teacher: [
    'view_dashboard',
    'take_attendance',
    'view_attendance',
    'view_statistics',
  ],
  treasurer: [
    'view_dashboard',
    'view_attendance',
    'view_statistics',
    'manage_payments',
  ],
  // Tài khoản chỉ dùng Trợ lý nhắc việc (không thấy phần lớp học)
  planner: [
    'use_work',
  ],
};

// Lấy hồ sơ (name/role) từ app_users theo auth_user_id, dựng thành User cho context.
async function loadProfile(authUserId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, email, name, role')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id, email: data.email, name: data.name, role: data.role };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // Khôi phục session Supabase Auth đã lưu (supabase-js tự quản lý trong localStorage)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;
      if (session?.user) {
        const profile = await loadProfile(session.user.id);
        if (active) setUser(profile);
      }
      if (active) setLoading(false);
    });

    // Đồng bộ khi session thay đổi (đăng nhập/đăng xuất/refresh token ở tab khác...)
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;
      if (session?.user) {
        const profile = await loadProfile(session.user.id);
        if (active) setUser(profile);
      } else {
        setUser(null);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      });

      if (error || !data.user) {
        return { success: false, error: 'Email hoặc mật khẩu không đúng' };
      }

      const profile = await loadProfile(data.user.id);
      if (!profile) {
        await supabase.auth.signOut();
        return { success: false, error: 'Tài khoản chưa được cấp quyền sử dụng, liên hệ Admin' };
      }

      setUser(profile);
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Có lỗi xảy ra, vui lòng thử lại' };
    }
  }

  function logout() {
    setUser(null);
    supabase.auth.signOut();
  }

  function hasPermission(permission: string): boolean {
    if (!user) return false;
    return rolePermissions[user.role]?.includes(permission) || false;
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

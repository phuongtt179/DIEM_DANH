'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher' | 'treasurer';
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
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for stored user on mount
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  async function login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('app_users')
        .select('id, email, name, role, password_hash')
        .eq('email', email.toLowerCase().trim())
        .single();

      if (error || !data) {
        return { success: false, error: 'Email không tồn tại' };
      }

      // Simple password check (in production, use proper hashing)
      if (data.password_hash !== password) {
        return { success: false, error: 'Mật khẩu không đúng' };
      }

      const userData: User = {
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
      };

      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Có lỗi xảy ra, vui lòng thử lại' };
    }
  }

  function logout() {
    setUser(null);
    localStorage.removeItem('user');
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

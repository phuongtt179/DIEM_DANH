import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database Types
export interface Class {
  id: string;
  name: string;
  subject: string;
  schedule: string;
  tuition: number;
  status?: 'active' | 'locked';
  locked_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Student {
  id: string;
  name: string;
  phone: string;
  parent_phone: string;
  class_id?: string; // Optional for backward compatibility with multi-class system
  note: string;
  status?: 'active' | 'on_leave';
  created_at?: string;
  updated_at?: string;
}

export interface Attendance {
  id: string;
  student_id: string;
  class_id: string;
  date: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  note: string;
  created_at?: string;
  updated_at?: string;
}

export interface Payment {
  id: string;
  student_id: string;
  class_id: string;
  month: string;
  amount: number;
  sessions: number;
  paid_date: string | null;
  status: 'paid' | 'unpaid';
  created_at?: string;
  updated_at?: string;
}

// New: Junction table for many-to-many student-class relationship
export interface StudentClass {
  id: string;
  student_id: string;
  class_id: string;
  is_primary: boolean;
  enrolled_at: string;
  created_at?: string;
  updated_at?: string;
}

// Extended types with joined data
export interface StudentWithClass extends Student {
  class_name?: string;
}

// New: Student with multiple classes
export interface StudentWithClasses extends Student {
  primary_class?: Class;
  secondary_classes?: Class[];
  class_count?: number;
  class_name?: string; // Backward compat
  class_id?: string; // Backward compat
}

export interface AttendanceWithStudent extends Attendance {
  student_name?: string;
}

export interface PaymentWithStudent extends Payment {
  student_name?: string;
}

// New: Payment with auto-calculated sessions
export interface PaymentWithSessions extends Payment {
  student_name?: string;
  calculated_sessions?: number; // Auto-calculated from attendance
  all_classes_names?: string[];
}

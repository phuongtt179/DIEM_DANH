-- Bước 3/3: Policy RLS THẬT theo vai trò (thay toàn bộ policy "allow all" cũ)
--
-- CHỈ chạy file này SAU KHI:
--   1) migration-auth-step1-prepare.sql và migration-auth-step2-create-accounts.sql
--      đã chạy xong, MỌI dòng app_users đều có auth_user_id (không còn NULL).
--   2) contexts/AuthContext.tsx đã deploy bản dùng Supabase Auth thật (bước 3 code)
--      và bạn đã tự đăng nhập thử đủ 4 vai trò thành công trên bản deploy đó.
--   3) Các API route /api/chat, /api/work/*, /api/journal đã deploy bản forward
--      Authorization header (bước 4 code) — nếu chưa, Chat AI / Trợ lý nhắc việc /
--      Nhật ký sẽ ngừng hoạt động ngay khi chạy file này.
--
-- Nếu chưa chắc cả 3 điều trên, DỪNG LẠI, đừng chạy file này.
-- Run this in Supabase SQL Editor

-- ============================================================
-- Helper functions (SECURITY DEFINER để tránh đệ quy RLS khi
-- policy của chính app_users/teacher_classes gọi lại chính nó)
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT role FROM app_users WHERE auth_user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT id FROM app_users WHERE auth_user_id = auth.uid()
$$;

-- ============================================================
-- classes / students / student_classes
-- Đọc: admin, teacher, treasurer. Ghi: chỉ admin.
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on classes" ON classes;
DROP POLICY IF EXISTS "classes_select" ON classes;
DROP POLICY IF EXISTS "classes_write" ON classes;
CREATE POLICY "classes_select" ON classes FOR SELECT
  USING (current_app_role() IN ('admin','teacher','treasurer'));
CREATE POLICY "classes_write" ON classes FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

DROP POLICY IF EXISTS "Allow all operations on students" ON students;
DROP POLICY IF EXISTS "students_select" ON students;
DROP POLICY IF EXISTS "students_write" ON students;
CREATE POLICY "students_select" ON students FOR SELECT
  USING (current_app_role() IN ('admin','teacher','treasurer'));
CREATE POLICY "students_write" ON students FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

DROP POLICY IF EXISTS "Allow all operations on student_classes" ON student_classes;
DROP POLICY IF EXISTS "student_classes_select" ON student_classes;
DROP POLICY IF EXISTS "student_classes_write" ON student_classes;
CREATE POLICY "student_classes_select" ON student_classes FOR SELECT
  USING (current_app_role() IN ('admin','teacher','treasurer'));
CREATE POLICY "student_classes_write" ON student_classes FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

-- ============================================================
-- attendance
-- Đọc: admin, teacher, treasurer.
-- Ghi: admin, hoặc teacher NHƯNG chỉ cho lớp mình phụ trách (teacher_classes).
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on attendance" ON attendance;
DROP POLICY IF EXISTS "attendance_select" ON attendance;
DROP POLICY IF EXISTS "attendance_write" ON attendance;
CREATE POLICY "attendance_select" ON attendance FOR SELECT
  USING (current_app_role() IN ('admin','teacher','treasurer'));
CREATE POLICY "attendance_write" ON attendance FOR ALL
  USING (
    current_app_role() = 'admin'
    OR (current_app_role() = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher_classes tc
      WHERE tc.user_id = current_app_user_id() AND tc.class_id = attendance.class_id
    ))
  )
  WITH CHECK (
    current_app_role() = 'admin'
    OR (current_app_role() = 'teacher' AND EXISTS (
      SELECT 1 FROM teacher_classes tc
      WHERE tc.user_id = current_app_user_id() AND tc.class_id = attendance.class_id
    ))
  );

-- ============================================================
-- payments
-- Đọc: admin, teacher, treasurer. Ghi: admin, treasurer.
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on payments" ON payments;
DROP POLICY IF EXISTS "payments_select" ON payments;
DROP POLICY IF EXISTS "payments_write" ON payments;
CREATE POLICY "payments_select" ON payments FOR SELECT
  USING (current_app_role() IN ('admin','teacher','treasurer'));
CREATE POLICY "payments_write" ON payments FOR ALL
  USING (current_app_role() IN ('admin','treasurer'))
  WITH CHECK (current_app_role() IN ('admin','treasurer'));

-- ============================================================
-- assistants / assistant_classes / assistant_sessions / assistant_payments
-- Chỉ admin.
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on assistants" ON assistants;
DROP POLICY IF EXISTS "assistants_admin" ON assistants;
CREATE POLICY "assistants_admin" ON assistants FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

DROP POLICY IF EXISTS "Allow all operations on assistant_classes" ON assistant_classes;
DROP POLICY IF EXISTS "assistant_classes_admin" ON assistant_classes;
CREATE POLICY "assistant_classes_admin" ON assistant_classes FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

DROP POLICY IF EXISTS "Allow all operations on assistant_sessions" ON assistant_sessions;
DROP POLICY IF EXISTS "assistant_sessions_admin" ON assistant_sessions;
CREATE POLICY "assistant_sessions_admin" ON assistant_sessions FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

DROP POLICY IF EXISTS "Allow all operations on assistant_payments" ON assistant_payments;
DROP POLICY IF EXISTS "assistant_payments_admin" ON assistant_payments;
CREATE POLICY "assistant_payments_admin" ON assistant_payments FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

-- ============================================================
-- teacher_classes
-- Đọc: admin, hoặc chính giáo viên đó xem lớp của mình. Ghi: admin.
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on teacher_classes" ON teacher_classes;
DROP POLICY IF EXISTS "teacher_classes_select" ON teacher_classes;
DROP POLICY IF EXISTS "teacher_classes_write" ON teacher_classes;
CREATE POLICY "teacher_classes_select" ON teacher_classes FOR SELECT
  USING (current_app_role() = 'admin' OR user_id = current_app_user_id());
CREATE POLICY "teacher_classes_write" ON teacher_classes FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

-- ============================================================
-- app_users
-- Đọc: admin xem tất cả, user tự xem dòng của mình (cần để lấy name/role sau khi login).
-- Ghi: chỉ admin (trang /users).
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on app_users" ON app_users;
DROP POLICY IF EXISTS "app_users_select" ON app_users;
DROP POLICY IF EXISTS "app_users_write" ON app_users;
CREATE POLICY "app_users_select" ON app_users FOR SELECT
  USING (current_app_role() = 'admin' OR auth_user_id = auth.uid());
CREATE POLICY "app_users_write" ON app_users FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

-- ============================================================
-- wp_events (Trợ lý nhắc việc) — owner-scoped thật (trước đây chỉ là quy ước)
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on wp_events" ON wp_events;
DROP POLICY IF EXISTS "wp_events_owner" ON wp_events;
CREATE POLICY "wp_events_owner" ON wp_events FOR ALL
  USING (owner_id = current_app_user_id())
  WITH CHECK (owner_id = current_app_user_id());

-- ============================================================
-- journal_entries — nhật ký dùng chung cho admin (đúng cách app/journal/page.tsx đang gate)
-- ============================================================

DROP POLICY IF EXISTS "Allow all operations on journal_entries" ON journal_entries;
DROP POLICY IF EXISTS "journal_entries_admin" ON journal_entries;
CREATE POLICY "journal_entries_admin" ON journal_entries FOR ALL
  USING (current_app_role() = 'admin') WITH CHECK (current_app_role() = 'admin');

-- Hàm admin_create_app_user / admin_set_user_password nằm ở migration-auth-step2b-admin-functions.sql

-- Kiểm tra: không bảng nào còn policy "Allow all" (qual = true).
SELECT tablename, policyname, cmd, qual FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;

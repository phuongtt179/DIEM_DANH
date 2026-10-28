-- LÙI LẠI bước 3: trả mọi bảng về policy "Allow all" như trước khi chạy migration-auth-step3-real-rls.sql.
-- CHỈ dùng khi chạy step3 xong mà app bị lỗi quyền (trang trống, không lưu được...).
-- Không đụng tới dữ liệu — chỉ đổi policy. Đăng nhập Supabase Auth vẫn giữ nguyên.
-- Run this in Supabase SQL Editor

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'classes','students','student_classes','attendance','payments',
    'assistants','assistant_classes','assistant_sessions','assistant_payments',
    'teacher_classes','app_users','wp_events','journal_entries'
  ] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
                   'Allow all operations on ' || t, t);
  END LOOP;
END $$;

SELECT tablename, policyname, cmd, qual FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;

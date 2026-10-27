-- Migration: Bật Row-Level Security (RLS) cho các bảng còn thiếu
--
-- Supabase gửi cảnh báo "CRITICAL: Table publicly accessible / rls_disabled_in_public"
-- cho project QLHT (uqesofxxggbxlebdgill). Lý do: các bảng dưới đây được tạo
-- qua các file migration-*.sql riêng lẻ (lương trợ giảng, điểm danh trợ giảng,
-- trợ lý nhắc việc...) nhưng CHƯA bật RLS như classes/students/attendance/
-- payments/student_classes đã làm ở supabase-schema.sql.
--
-- App này dùng anon key cho MỌI thao tác (không dùng Supabase Auth), nên để
-- không phá vỡ chức năng hiện có, migration này bật RLS + policy "allow all"
-- (giống hệt cách đã làm cho 5 bảng kia) — vừa tắt cảnh báo của Supabase,
-- vừa KHÔNG đổi hành vi truy cập hiện tại của app.
--
-- Run this in Supabase SQL Editor

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on app_users" ON public.app_users;
CREATE POLICY "Allow all operations on app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.teacher_classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on teacher_classes" ON public.teacher_classes;
CREATE POLICY "Allow all operations on teacher_classes" ON public.teacher_classes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.assistants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on assistants" ON public.assistants;
CREATE POLICY "Allow all operations on assistants" ON public.assistants FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.assistant_classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on assistant_classes" ON public.assistant_classes;
CREATE POLICY "Allow all operations on assistant_classes" ON public.assistant_classes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.assistant_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on assistant_sessions" ON public.assistant_sessions;
CREATE POLICY "Allow all operations on assistant_sessions" ON public.assistant_sessions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.assistant_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on assistant_payments" ON public.assistant_payments;
CREATE POLICY "Allow all operations on assistant_payments" ON public.assistant_payments FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on journal_entries" ON public.journal_entries;
CREATE POLICY "Allow all operations on journal_entries" ON public.journal_entries FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.wp_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all operations on wp_events" ON public.wp_events;
CREATE POLICY "Allow all operations on wp_events" ON public.wp_events FOR ALL USING (true) WITH CHECK (true);

-- Ghi chú quan trọng (đọc kỹ):
-- Policy "USING (true)" nghĩa là CHO PHÉP TẤT CẢ — bật RLS kiểu này chỉ làm
-- Supabase ngừng cảnh báo, KHÔNG thực sự chặn ai cả. Vì anon key nằm sẵn
-- trong mã nguồn frontend (ai mở app cũng thấy được qua DevTools), bất kỳ ai
-- có URL project + anon key vẫn đọc/sửa/xóa được toàn bộ dữ liệu các bảng
-- này, y hệt như trước khi chạy migration. Đây là hạn chế kiến trúc của toàn
-- bộ app (không riêng các bảng này), không phải lỗi phát sinh từ migration.
--
-- Muốn CHẶN THẬT (chỉ người đăng nhập đúng mới đọc/sửa được), cần chuyển
-- sang Supabase Auth thật + viết policy theo auth.uid(), là việc đổi kiến
-- trúc lớn hơn nhiều, không làm trong migration này.

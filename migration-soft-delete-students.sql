-- Migration: Soft-delete cho học sinh
-- Mục đích: Khi xóa học sinh, GIỮ LẠI lịch sử điểm danh + học phí (để báo cáo doanh thu
-- theo tháng/quý/năm không bị mất số liệu cũ), chỉ ẩn học sinh khỏi các màn hình
-- "hiện tại" (danh sách học sinh, điểm danh, thu học phí, đếm sĩ số...).
-- Run this in Supabase SQL Editor

ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_students_deleted_at ON students(deleted_at);

-- Ghi chú:
-- - deleted_at NULL  => học sinh đang hoạt động bình thường
-- - deleted_at có giá trị => học sinh đã bị "xóa" (ẩn khỏi danh sách/điểm danh/thu phí hiện tại),
--   nhưng payments/attendance cũ của em vẫn còn nguyên trong DB để cộng vào doanh thu.

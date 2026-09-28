-- Migration: Sửa lỗi "xóa lớp học" làm mất doanh thu
--
-- Vấn đề: cột students.class_id (cột cũ, được trigger tự đồng bộ = lớp CHÍNH
-- của học sinh) có khóa ngoại ON DELETE CASCADE trỏ tới classes(id). Nghĩa là
-- xóa 1 lớp học sẽ XÓA LUÔN học sinh có lớp đó là lớp chính, và vì
-- payments.student_id / attendance.student_id đều ON DELETE CASCADE từ
-- students(id), toàn bộ lịch sử học phí + điểm danh của em đó (kể cả ở
-- NHỮNG LỚP KHÁC) bị xóa theo, làm sai tổng doanh thu.
--
-- Run this in Supabase SQL Editor

-- 1) Đổi khóa ngoại students.class_id: chỉ NULL hóa, KHÔNG xóa học sinh
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_class_id_fkey;
ALTER TABLE students
  ADD CONSTRAINT students_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;

-- 2) Soft-delete cho lớp học: "Xóa lớp" chỉ ẩn lớp khỏi danh sách/điểm danh/
--    thu học phí hiện tại, KHÔNG xóa dòng classes => payments/attendance cũ
--    vẫn join được tên lớp, doanh thu theo tháng/quý/năm không bị mất số liệu.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_classes_deleted_at ON classes(deleted_at);

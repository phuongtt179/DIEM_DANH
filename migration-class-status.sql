-- Migration: Thêm trạng thái khóa lớp và tạm nghỉ học sinh
-- Chạy file này trong Supabase SQL Editor

-- 1. Thêm cột status và locked_at vào bảng classes
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active', 'locked')),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP;

-- 2. Thêm cột status vào bảng students (cho tính năng tạm nghỉ)
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active', 'on_leave'));

-- 3. Cập nhật dữ liệu cũ
UPDATE classes SET status = 'active' WHERE status IS NULL;
UPDATE students SET status = 'active' WHERE status IS NULL;

-- ============================================================
-- Điểm danh trợ giảng: thêm trạng thái đi dạy / vắng
-- Thêm cột status vào assistant_sessions. Các dòng cũ mặc định 'present' (đã đi dạy).
-- present = đi dạy (✓, tính lương), absent = vắng (✗, không tính lương, sessions_count=0).
-- Chạy trong Supabase SQL Editor → Run.
-- ============================================================

alter table public.assistant_sessions
  add column if not exists status text not null default 'present';

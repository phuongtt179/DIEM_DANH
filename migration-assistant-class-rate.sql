-- ============================================================
-- Lương trợ giảng theo TỪNG LỚP: thêm đơn giá/buổi riêng cho mỗi cặp (trợ giảng, lớp)
-- Trước đây đơn giá là hằng số cứng 100.000đ/buổi áp dụng chung cho tất cả.
-- Cột mới cho phép mỗi trợ giảng có mức lương khác nhau tùy theo lớp phụ trách.
-- Chạy trong Supabase SQL Editor → Run.
-- ============================================================

alter table public.assistant_classes
  add column if not exists rate_per_session numeric not null default 100000;

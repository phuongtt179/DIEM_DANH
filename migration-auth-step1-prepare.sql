-- Bước 1/3: Chuẩn bị cho việc chuyển sang Supabase Auth thật
-- An toàn tuyệt đối — không đổi hành vi app, không đụng dữ liệu cũ.
-- Run this in Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- Bước 2/3: Tạo tài khoản Supabase Auth thật cho từng user đang có trong app_users
-- Dùng lại ĐÚNG mật khẩu hiện tại (app_users.password_hash đang là plaintext) nên
-- người dùng không cần đổi mật khẩu, không ảnh hưởng gì tới trải nghiệm đăng nhập.
--
-- An toàn: chạy trong 1 khối DO $$ — nếu có lỗi ở bất kỳ dòng nào, TOÀN BỘ sẽ
-- rollback, không để lại trạng thái nửa vời. Chỉ xử lý user CHƯA có auth_user_id
-- nên chạy lại nhiều lần vẫn an toàn (không tạo trùng).
--
-- Chạy bước 1 (migration-auth-step1-prepare.sql) TRƯỚC file này.
-- Run this in Supabase SQL Editor

DO $$
DECLARE
  r RECORD;
  new_auth_id UUID;
BEGIN
  FOR r IN SELECT * FROM app_users WHERE auth_user_id IS NULL LOOP
    new_auth_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_auth_id,
      'authenticated',
      'authenticated',
      r.email,
      crypt(r.password_hash, gen_salt('bf')),
      now(),
      NULL,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', r.name),
      false,
      now(),
      now(),
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      new_auth_id,
      new_auth_id::text,
      jsonb_build_object('sub', new_auth_id::text, 'email', r.email, 'email_verified', true),
      'email',
      now(), now(), now()
    );

    UPDATE app_users SET auth_user_id = new_auth_id WHERE id = r.id;

    RAISE NOTICE 'Đã tạo tài khoản Auth cho: % (%)', r.email, r.role;
  END LOOP;
END $$;

-- Kiểm tra lại sau khi chạy: mọi user phải có auth_user_id, không còn NULL.
SELECT id, email, name, role, auth_user_id FROM app_users ORDER BY created_at;

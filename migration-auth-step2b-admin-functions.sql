-- Bước 2b: Hàm cho trang /users (admin tạo user mới / đổi mật khẩu) + helper vai trò.
-- CHỈ tạo hàm, KHÔNG đổi policy RLS nào — chạy ngay sau bước 2, an toàn, không ảnh hưởng dữ liệu.
-- Chạy lại nhiều lần vẫn an toàn (CREATE OR REPLACE).
-- Run this in Supabase SQL Editor

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

-- IS DISTINCT FROM: người gọi chưa đăng nhập → role NULL → vẫn bị chặn (dùng <> sẽ lọt qua).
-- search_path có "extensions" vì trên Supabase crypt()/gen_salt() (pgcrypto) nằm ở schema đó.

CREATE OR REPLACE FUNCTION public.admin_create_app_user(
  p_email text, p_password text, p_name text, p_role text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  new_auth_id uuid;
  new_app_id uuid;
  v_email text := lower(trim(p_email));
BEGIN
  IF current_app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email)
     OR EXISTS (SELECT 1 FROM app_users WHERE email = v_email) THEN
    RAISE EXCEPTION 'Email đã tồn tại';
  END IF;

  new_auth_id := gen_random_uuid();

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', new_auth_id, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', p_name),
    false, now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), new_auth_id, new_auth_id::text,
          jsonb_build_object('sub', new_auth_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  INSERT INTO app_users (email, name, role, password_hash, auth_user_id)
  VALUES (v_email, p_name, p_role, p_password, new_auth_id)
  RETURNING id INTO new_app_id;

  RETURN new_app_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_password(p_app_user_id uuid, p_password text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  target_auth_id uuid;
BEGIN
  IF current_app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT auth_user_id INTO target_auth_id FROM app_users WHERE id = p_app_user_id;
  IF target_auth_id IS NULL THEN
    RAISE EXCEPTION 'user not found or not migrated to Supabase Auth yet';
  END IF;

  UPDATE auth.users SET encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
  WHERE id = target_auth_id;

  UPDATE app_users SET password_hash = p_password, updated_at = now() WHERE id = p_app_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_app_user(text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_app_user(text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid,text) TO authenticated;

-- Báo PostgREST nạp lại danh sách hàm ngay (khỏi lỗi "Could not find the function").
NOTIFY pgrst, 'reload schema';

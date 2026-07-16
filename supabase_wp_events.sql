-- ============================================================
-- Trợ lý nhắc việc (GĐ1) — bảng công việc/sự kiện
-- Kiến trúc tách-sẵn: tiền tố wp_, owner-scoped (mỗi tài khoản chỉ thấy dữ liệu của mình).
-- Chạy trong Supabase SQL Editor. App dùng anon key, KHÔNG bật RLS (giống các bảng khác) → chọn "Run".
-- ============================================================

create table if not exists public.wp_events (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,                  -- app_users.id — chủ sở hữu công việc
  title       text not null,                  -- tên việc / sự kiện
  type        text not null default 'event',  -- 'event' (sự kiện có giờ) | 'task' (việc có hạn)
  start_at    timestamptz,                    -- sự kiện: thời điểm diễn ra (ngày + giờ)
  due_date    date,                           -- việc: hạn nộp
  location    text,                           -- địa điểm
  note        text,                           -- cần chuẩn bị / ghi chú
  status      text not null default 'active', -- 'active' | 'done' | 'canceled' (quá hạn tự suy ra)
  source_text text,                           -- văn bản gốc (giấy mời / tin Zalo) để đối chiếu
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists wp_events_owner_idx       on public.wp_events (owner_id);
create index if not exists wp_events_owner_start_idx on public.wp_events (owner_id, start_at);
create index if not exists wp_events_owner_due_idx   on public.wp_events (owner_id, due_date);

create table if not exists public.user_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  device_id text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  fcm_token text not null,
  app_version text,
  device_name text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create unique index if not exists user_push_devices_user_device_key
  on public.user_push_devices (user_id, device_id);

create index if not exists user_push_devices_user_active_idx
  on public.user_push_devices (user_id, last_seen_at desc)
  where revoked_at is null;

create index if not exists user_push_devices_device_id_idx
  on public.user_push_devices (device_id);

do $$
begin
  create type public.notification_status as enum ('UNREAD', 'READ');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.notification_type as enum (
    'EXPENSE_CREATED',
    'EXPENSE_UPDATED',
    'SYSTEM'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  message text not null,
  status public.notification_status not null default 'UNREAD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_created_at_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where status = 'UNREAD';

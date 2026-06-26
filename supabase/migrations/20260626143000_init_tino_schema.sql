-- Initial schema for Tino Expense.
-- Auth is owned by the Express API; Supabase Auth is intentionally not used.

create extension if not exists pgcrypto;

do $$
begin
  create type public.user_status as enum ('active', 'inactive');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.group_type as enum ('personal', 'shared');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.group_currency as enum ('VND', 'USD');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.group_member_role as enum ('owner', 'member');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.group_member_status as enum ('active', 'inactive');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.expense_split_method as enum ('equal', 'amount', 'percentage', 'shares');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.settlement_status as enum ('pending', 'paid', 'cancelled');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password text not null,
  display_name text not null,
  avatar_url text,
  status public.user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  type public.group_type not null default 'personal',
  currency public.group_currency not null default 'VND',
  owner_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.group_member_role not null default 'member',
  status public.group_member_status not null default 'active',
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  color text,
  icon text,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  description text,
  total_amount numeric(14, 2) not null check (total_amount > 0),
  currency public.group_currency not null default 'VND',
  paid_by_user_id uuid not null references public.users(id) on delete restrict,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  expense_date date not null default current_date,
  split_method public.expense_split_method not null default 'equal',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(14, 2),
  percentage numeric(8, 4),
  shares numeric(14, 4),
  created_at timestamptz not null default now(),
  unique (expense_id, user_id),
  check (amount is null or amount >= 0),
  check (percentage is null or (percentage >= 0 and percentage <= 100)),
  check (shares is null or shares >= 0)
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  file_url text not null,
  file_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  uploaded_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user_id uuid not null references public.users(id) on delete restrict,
  to_user_id uuid not null references public.users(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  currency public.group_currency not null default 'VND',
  period_start date not null,
  period_end date not null,
  status public.settlement_status not null default 'pending',
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  check (period_end > period_start)
);

create index if not exists users_email_idx on public.users (email);
create index if not exists groups_owner_id_idx on public.groups (owner_id);
create index if not exists group_members_group_id_idx on public.group_members (group_id);
create index if not exists group_members_user_id_idx on public.group_members (user_id);
create index if not exists categories_group_id_idx on public.categories (group_id);
create index if not exists expenses_group_date_idx on public.expenses (group_id, expense_date desc) where deleted_at is null;
create index if not exists expenses_paid_by_user_id_idx on public.expenses (paid_by_user_id);
create index if not exists expense_splits_expense_id_idx on public.expense_splits (expense_id);
create index if not exists expense_splits_user_id_idx on public.expense_splits (user_id);
create index if not exists attachments_expense_id_idx on public.attachments (expense_id);
create index if not exists settlements_group_period_idx on public.settlements (group_id, period_start, period_end);
create index if not exists settlements_from_user_id_idx on public.settlements (from_user_id);
create index if not exists settlements_to_user_id_idx on public.settlements (to_user_id);

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists set_groups_updated_at on public.groups;
create trigger set_groups_updated_at
before update on public.groups
for each row execute function public.set_updated_at();

drop trigger if exists set_expenses_updated_at on public.expenses;
create trigger set_expenses_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

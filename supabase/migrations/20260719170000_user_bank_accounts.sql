create table if not exists public.user_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  bank_name text not null,
  bank_bin text not null,
  account_number text not null,
  account_name text not null,
  qr_image_url text,
  qr_image_path text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists user_bank_accounts_user_id_idx
  on public.user_bank_accounts (user_id);

create unique index if not exists user_bank_accounts_one_default_idx
  on public.user_bank_accounts (user_id)
  where is_default;

drop trigger if exists set_user_bank_accounts_updated_at on public.user_bank_accounts;
create trigger set_user_bank_accounts_updated_at
before update on public.user_bank_accounts
for each row execute function public.set_updated_at();

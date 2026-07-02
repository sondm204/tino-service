create table if not exists public.telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_username text,
  telegram_display_name text,
  linked_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.telegram_chat_wallets (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null unique,
  wallet_id uuid not null unique references public.wallets(id) on delete cascade,
  telegram_chat_title text,
  connected_by_user_id uuid not null references public.users(id) on delete restrict,
  connected_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_wallet_connect_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  created_by_user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_accounts_user_id_idx
  on public.telegram_accounts (user_id);
create index if not exists telegram_chat_wallets_wallet_id_idx
  on public.telegram_chat_wallets (wallet_id);
create index if not exists telegram_link_codes_active_idx
  on public.telegram_link_codes (code, expires_at)
  where consumed_at is null;
create index if not exists telegram_wallet_connect_codes_active_idx
  on public.telegram_wallet_connect_codes (code, expires_at)
  where consumed_at is null;

drop trigger if exists set_telegram_accounts_updated_at
  on public.telegram_accounts;
create trigger set_telegram_accounts_updated_at
before update on public.telegram_accounts
for each row execute function public.set_updated_at();

drop trigger if exists set_telegram_chat_wallets_updated_at
  on public.telegram_chat_wallets;
create trigger set_telegram_chat_wallets_updated_at
before update on public.telegram_chat_wallets
for each row execute function public.set_updated_at();

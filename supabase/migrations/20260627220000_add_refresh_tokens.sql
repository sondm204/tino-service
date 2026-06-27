create table if not exists public.auth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_token_id uuid references public.auth_refresh_tokens(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists auth_refresh_tokens_user_id_idx
  on public.auth_refresh_tokens (user_id);

create index if not exists auth_refresh_tokens_active_idx
  on public.auth_refresh_tokens (token_hash, expires_at)
  where revoked_at is null;

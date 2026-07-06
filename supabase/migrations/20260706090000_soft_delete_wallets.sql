alter table public.wallets
  add column if not exists deleted_at timestamptz;

create index if not exists wallets_active_owner_id_idx
  on public.wallets (owner_id)
  where deleted_at is null;

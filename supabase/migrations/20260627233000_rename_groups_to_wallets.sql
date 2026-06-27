alter type public.group_type rename to wallet_type;
alter type public.group_currency rename to wallet_currency;
alter type public.group_member_role rename to wallet_member_role;
alter type public.group_member_status rename to wallet_member_status;

alter table public.groups rename to wallets;
alter table public.group_members rename to wallet_members;

alter table public.wallet_members rename column group_id to wallet_id;
alter table public.categories rename column group_id to wallet_id;
alter table public.expenses rename column group_id to wallet_id;
alter table public.settlements rename column group_id to wallet_id;

alter table public.wallets rename constraint groups_pkey to wallets_pkey;
alter table public.wallets rename constraint groups_owner_id_fkey to wallets_owner_id_fkey;

alter table public.wallet_members
  rename constraint group_members_pkey to wallet_members_pkey;
alter table public.wallet_members
  rename constraint group_members_group_id_fkey to wallet_members_wallet_id_fkey;
alter table public.wallet_members
  rename constraint group_members_user_id_fkey to wallet_members_user_id_fkey;
alter table public.wallet_members
  rename constraint group_members_group_id_user_id_key
  to wallet_members_wallet_id_user_id_key;

alter table public.categories
  rename constraint categories_group_id_fkey to categories_wallet_id_fkey;
alter table public.categories
  rename constraint categories_group_id_name_key to categories_wallet_id_name_key;

alter table public.expenses
  rename constraint expenses_group_id_fkey to expenses_wallet_id_fkey;

alter table public.settlements
  rename constraint settlements_group_id_fkey to settlements_wallet_id_fkey;

alter index public.groups_owner_id_idx rename to wallets_owner_id_idx;
alter index public.group_members_group_id_idx rename to wallet_members_wallet_id_idx;
alter index public.group_members_user_id_idx rename to wallet_members_user_id_idx;
alter index public.categories_group_id_idx rename to categories_wallet_id_idx;
alter index public.expenses_group_date_idx rename to expenses_wallet_date_idx;
alter index public.settlements_group_period_idx rename to settlements_wallet_period_idx;

alter trigger set_groups_updated_at on public.wallets
  rename to set_wallets_updated_at;

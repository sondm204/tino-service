import { AppError } from '../../common/app-error.js';
import {
  WalletCurrency,
  WalletMemberRole,
  WalletMemberStatus,
  WalletType,
  isEnumValue,
} from '../../common/enums.js';
import type { PageableRequest } from '../../common/pageable.js';
import { toPageableResponse, toSupabaseRange } from '../../common/pageable.js';
import { supabase } from '../../db/supabase.js';

export type CreateWalletRequest = {
  name?: string;
  description?: string | null;
  type?: string;
  currency?: string;
  owner_id?: string;
};

export type WalletResponse = {
  id: string;
  name: string;
  description: string | null;
  type: WalletType;
  currency: WalletCurrency;
  owner_id: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  total_amount?: number;
  user_share_amount?: number;
};

export type WalletMemberResponse = {
  id: string;
  wallet_id: string;
  user_id: string;
  role: WalletMemberRole;
  status: WalletMemberStatus;
  joined_at: string;
};

export type WalletMemberWithUserResponse = WalletMemberResponse & {
  user: {
    id: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
    status: string;
  };
};

export type AddWalletMemberRequest = {
  user_id?: string;
  role?: string;
  status?: string;
};

type ExpenseRow = {
  id: string;
  wallet_id: string;
  total_amount: number | string;
  paid_by_user_id: string;
};

type SummaryExpenseRow = Omit<ExpenseRow, 'wallet_id'>;

type ExpenseSplitRow = {
  expense_id: string;
  user_id: string;
  amount: number | string | null;
};

function getMonthPeriod(month: string | undefined) {
  const targetMonth = month || new Date().toISOString().slice(0, 7);

  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'month must use YYYY-MM format');
  }

  const periodStart = `${targetMonth}-01`;
  const periodEnd = new Date(`${periodStart}T00:00:00.000Z`);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  return {
    periodStart,
    periodEndDate: periodEnd.toISOString().slice(0, 10),
  };
}

export async function listWallets(
  pageable: PageableRequest,
  userId?: string,
  month?: string
) {
  if (!userId) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
  }

  return listWalletsWithTotals(pageable, userId, month);
}

export async function listWalletsWithTotals(
  pageable: PageableRequest,
  userId: string,
  month?: string
) {
  const { periodStart, periodEndDate } = getMonthPeriod(month);
  const { from, to } = toSupabaseRange(pageable);
  const { data, error, count } = await supabase
    .from('wallets')
    .select('*, wallet_members!inner(user_id, status)', { count: 'exact' })
    .eq('wallet_members.user_id', userId)
    .eq('wallet_members.status', WalletMemberStatus.Active)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new AppError(400, 'WALLET_LIST_FAILED', error.message);
  }

  const wallets = (data ?? []).map((row) => {
    const {
      wallet_members: _walletMembers,
      ...wallet
    } = row as WalletResponse & { wallet_members: unknown };
    return wallet;
  });
  const walletIds = wallets.map((wallet) => wallet.id);

  if (walletIds.length === 0) {
    return toPageableResponse(wallets, pageable, count ?? 0);
  }

  const [expensesResult, membersResult] = await Promise.all([
    supabase
      .from('expenses')
      .select('id, wallet_id, total_amount, paid_by_user_id')
      .in('wallet_id', walletIds)
      .gte('expense_date', periodStart)
      .lt('expense_date', periodEndDate)
      .is('deleted_at', null),
    supabase
      .from('wallet_members')
      .select('*')
      .in('wallet_id', walletIds)
      .eq('status', WalletMemberStatus.Active),
  ]);

  const { data: expenses, error: expensesError } = expensesResult;

  if (expensesError) {
    throw new AppError(400, 'EXPENSE_LIST_FAILED', expensesError.message);
  }

  const { data: members, error: membersError } = membersResult;

  if (membersError) {
    throw new AppError(400, 'WALLET_MEMBER_LIST_FAILED', membersError.message);
  }

  const expenseRows = (expenses ?? []) as ExpenseRow[];
  const expenseIds = expenseRows.map((expense) => expense.id);
  const totalsByWallet = new Map<string, number>();
  const membersByWallet = new Map<string, string[]>();
  const splitsByExpense = new Map<string, ExpenseSplitRow[]>();

  for (const member of (members ?? []) as WalletMemberResponse[]) {
    const current = membersByWallet.get(member.wallet_id) ?? [];
    current.push(member.user_id);
    membersByWallet.set(member.wallet_id, current);
  }

  if (expenseIds.length > 0) {
    const { data: splits, error: splitsError } = await supabase
      .from('expense_splits')
      .select('expense_id, user_id, amount')
      .in('expense_id', expenseIds);

    if (splitsError) {
      throw new AppError(400, 'EXPENSE_SPLIT_LIST_FAILED', splitsError.message);
    }

    for (const split of (splits ?? []) as ExpenseSplitRow[]) {
      const current = splitsByExpense.get(split.expense_id) ?? [];
      current.push(split);
      splitsByExpense.set(split.expense_id, current);
    }
  }

  const userShareByWallet = new Map<string, number>();

  for (const expense of expenseRows) {
    const amount = Number(expense.total_amount);
    totalsByWallet.set(expense.wallet_id, (totalsByWallet.get(expense.wallet_id) ?? 0) + amount);

    const splits = splitsByExpense.get(expense.id) ?? [];
    const userSplit = splits.find((split) => split.user_id === userId);
    let userShare = 0;

    if (userSplit) {
      userShare = Number(userSplit.amount ?? 0);
    } else if (splits.length === 0) {
      const activeMemberIds = membersByWallet.get(expense.wallet_id) ?? [];

      if (activeMemberIds.includes(userId) && activeMemberIds.length > 0) {
        userShare = amount / activeMemberIds.length;
      }
    }

    if (userShare > 0) {
      userShareByWallet.set(
        expense.wallet_id,
        (userShareByWallet.get(expense.wallet_id) ?? 0) + userShare
      );
    }
  }

  const walletsWithTotals = wallets.map((wallet) => ({
    ...wallet,
    total_amount: totalsByWallet.get(wallet.id) ?? 0,
    user_share_amount: userShareByWallet.get(wallet.id) ?? 0,
  }));

  return toPageableResponse(walletsWithTotals, pageable, count ?? 0);
}

export async function getWallet(walletId: string) {
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('id', walletId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
  }

  return data as WalletResponse;
}

export async function requireWalletMember(walletId: string, userId: string) {
  await getWallet(walletId);

  const { data, error } = await supabase
    .from('wallet_members')
    .select('id, wallet_id, user_id, role, status, joined_at')
    .eq('wallet_id', walletId)
    .eq('user_id', userId)
    .eq('status', WalletMemberStatus.Active)
    .single();

  if (error || !data) {
    throw new AppError(
      403,
      'WALLET_ACCESS_DENIED',
      'You are not an active member of this wallet'
    );
  }

  return data as WalletMemberResponse;
}

export async function requireWalletOwner(walletId: string, userId: string) {
  const member = await requireWalletMember(walletId, userId);

  if (member.role !== WalletMemberRole.Owner) {
    throw new AppError(
      403,
      'WALLET_OWNER_REQUIRED',
      'Only the wallet owner can perform this action'
    );
  }

  return member;
}

export async function listWalletMembers(walletId: string, actorUserId: string) {
  await requireWalletMember(walletId, actorUserId);

  const { data, error } = await supabase
    .from('wallet_members')
    .select(
      `
        id,
        wallet_id,
        user_id,
        role,
        status,
        joined_at,
        user:users!wallet_members_user_id_fkey (
          id,
          email,
          display_name,
          avatar_url,
          status
        )
      `
    )
    .eq('wallet_id', walletId)
    .eq('status', WalletMemberStatus.Active)
    .order('joined_at', { ascending: true });

  if (error) {
    throw new AppError(400, 'WALLET_MEMBER_LIST_FAILED', error.message);
  }

  return (data ?? []) as unknown as WalletMemberWithUserResponse[];
}

export async function createWallet(payload: CreateWalletRequest, ownerId: string) {
  const name = payload.name?.trim();
  const description = payload.description?.trim() || null;
  const type = payload.type?.trim() || WalletType.Personal;
  const currency = payload.currency?.trim().toUpperCase() || WalletCurrency.VND;

  if (!name) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Wallet name is required');
  }

  if (!isEnumValue(WalletType, type)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'type is invalid');
  }

  if (!isEnumValue(WalletCurrency, currency)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'currency is invalid');
  }

  const { data: wallet, error: walletError } = await supabase
    .from('wallets')
    .insert({
      name,
      description,
      type,
      currency,
      owner_id: ownerId,
    })
    .select('*')
    .single();

  if (walletError) {
    throw new AppError(400, 'WALLET_CREATE_FAILED', walletError.message);
  }

  const { data: member, error: memberError } = await supabase
    .from('wallet_members')
    .insert({
      wallet_id: wallet.id,
      user_id: ownerId,
      role: WalletMemberRole.Owner,
      status: WalletMemberStatus.Active,
    })
    .select('*')
    .single();

  if (memberError) {
    await supabase.from('wallets').delete().eq('id', wallet.id);

    throw new AppError(400, 'WALLET_MEMBER_CREATE_FAILED', memberError.message);
  }

  return {
    wallet: wallet as WalletResponse,
    member: member as WalletMemberResponse,
  };
}

export async function addWalletMember(
  walletId: string,
  payload: AddWalletMemberRequest,
  actorUserId: string
) {
  const userId = payload.user_id?.trim();
  const role = payload.role?.trim() || WalletMemberRole.Member;
  const status = payload.status?.trim() || WalletMemberStatus.Active;

  if (!userId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'user_id is required');
  }

  if (!isEnumValue(WalletMemberRole, role)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'role is invalid');
  }

  if (!isEnumValue(WalletMemberStatus, status)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'status is invalid');
  }

  await requireWalletOwner(walletId, actorUserId);

  const { data, error } = await supabase
    .from('wallet_members')
    .insert({
      wallet_id: walletId,
      user_id: userId,
      role,
      status,
    })
    .select('*')
    .single();

  if (error) {
    throw new AppError(400, 'WALLET_MEMBER_CREATE_FAILED', error.message);
  }

  return data as WalletMemberResponse;
}

export async function deleteWallet(walletId: string, actorUserId: string) {
  await requireWalletOwner(walletId, actorUserId);

  const { data, error } = await supabase
    .from('wallets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', walletId)
    .is('deleted_at', null)
    .select('id')
    .single();

  if (error || !data) {
    throw new AppError(400, 'WALLET_DELETE_FAILED', error?.message || 'Wallet delete failed');
  }

  return { id: data.id as string };
}

export async function getWalletSummary(
  walletId: string,
  month: string | undefined,
  userId: string
) {
  await requireWalletMember(walletId, userId);
  const { periodStart, periodEndDate } = getMonthPeriod(month);

  const [wallet, membersResult, expensesResult] = await Promise.all([
    getWallet(walletId),
    supabase
      .from('wallet_members')
      .select('*')
      .eq('wallet_id', walletId)
      .eq('status', WalletMemberStatus.Active),
    supabase
      .from('expenses')
      .select('id, total_amount, paid_by_user_id')
      .eq('wallet_id', walletId)
      .gte('expense_date', periodStart)
      .lt('expense_date', periodEndDate)
      .is('deleted_at', null),
  ]);

  const { data: members, error: membersError } = membersResult;

  if (membersError) {
    throw new AppError(400, 'WALLET_MEMBER_LIST_FAILED', membersError.message);
  }

  const activeMembers = (members ?? []) as WalletMemberResponse[];
  const { data: expenses, error: expensesError } = expensesResult;

  if (expensesError) {
    throw new AppError(400, 'EXPENSE_LIST_FAILED', expensesError.message);
  }

  const expenseRows = (expenses ?? []) as SummaryExpenseRow[];
  const expenseIds = expenseRows.map((expense) => expense.id);
  const splitsByExpense = new Map<string, ExpenseSplitRow[]>();

  if (expenseIds.length > 0) {
    const { data: splits, error: splitsError } = await supabase
      .from('expense_splits')
      .select('expense_id, user_id, amount')
      .in('expense_id', expenseIds);

    if (splitsError) {
      throw new AppError(400, 'EXPENSE_SPLIT_LIST_FAILED', splitsError.message);
    }

    for (const split of (splits ?? []) as ExpenseSplitRow[]) {
      const current = splitsByExpense.get(split.expense_id) ?? [];
      current.push(split);
      splitsByExpense.set(split.expense_id, current);
    }
  }

  const paidByUser = new Map<string, number>();
  const shareByUser = new Map<string, number>();
  const activeUserIds = activeMembers.map((member) => member.user_id);
  let totalAmount = 0;

  for (const expense of expenseRows) {
    const amount = Number(expense.total_amount);
    totalAmount += amount;
    paidByUser.set(
      expense.paid_by_user_id,
      (paidByUser.get(expense.paid_by_user_id) ?? 0) + amount
    );

    const splits = splitsByExpense.get(expense.id) ?? [];

    if (splits.length > 0) {
      for (const split of splits) {
        shareByUser.set(
          split.user_id,
          (shareByUser.get(split.user_id) ?? 0) + Number(split.amount ?? 0)
        );
      }
    } else if (activeUserIds.length > 0) {
      const equalShare = amount / activeUserIds.length;

      for (const userId of activeUserIds) {
        shareByUser.set(userId, (shareByUser.get(userId) ?? 0) + equalShare);
      }
    }
  }

  const balances = activeMembers.map((member) => {
    const paid = paidByUser.get(member.user_id) ?? 0;
    const share = shareByUser.get(member.user_id) ?? 0;

    return {
      user_id: member.user_id,
      paid,
      share,
      balance: paid - share,
    };
  });

  const creditors = balances
    .filter((item) => item.balance > 0)
    .map((item) => ({ user_id: item.user_id, amount: item.balance }));
  const debtors = balances
    .filter((item) => item.balance < 0)
    .map((item) => ({ user_id: item.user_id, amount: Math.abs(item.balance) }));
  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0) {
      settlements.push({
        from_user_id: debtor.user_id,
        to_user_id: creditor.user_id,
        amount,
        currency: wallet.currency,
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount <= 0.01) {
      creditorIndex += 1;
    }

    if (debtor.amount <= 0.01) {
      debtorIndex += 1;
    }
  }

  return {
    wallet,
    period_start: periodStart,
    period_end: periodEndDate,
    total_amount: totalAmount,
    currency: wallet.currency,
    member_balances: balances,
    settlements,
  };
}

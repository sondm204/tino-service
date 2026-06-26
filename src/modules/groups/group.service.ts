import { AppError } from '../../common/app-error.js';
import {
  GroupCurrency,
  GroupMemberRole,
  GroupMemberStatus,
  GroupType,
  isEnumValue,
} from '../../common/enums.js';
import type { PageableRequest } from '../../common/pageable.js';
import { toPageableResponse, toSupabaseRange } from '../../common/pageable.js';
import { supabase } from '../../db/supabase.js';

export type CreateGroupRequest = {
  name?: string;
  description?: string | null;
  type?: string;
  currency?: string;
  owner_id?: string;
};

export type GroupResponse = {
  id: string;
  name: string;
  description: string | null;
  type: GroupType;
  currency: GroupCurrency;
  owner_id: string;
  created_at: string;
  updated_at: string | null;
  total_amount?: number;
  user_share_amount?: number;
};

export type GroupMemberResponse = {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  joined_at: string;
};

export type AddGroupMemberRequest = {
  user_id?: string;
  role?: string;
  status?: string;
};

type ExpenseRow = {
  id: string;
  group_id: string;
  total_amount: number | string;
  paid_by_user_id: string;
};

type ExpenseSplitRow = {
  expense_id: string;
  user_id: string;
  amount: number | string | null;
};

export async function listGroups(pageable: PageableRequest, userId?: string) {
  return listGroupsWithTotals(pageable, userId);
}

export async function listGroupsWithTotals(pageable: PageableRequest, userId?: string) {
  const { from, to } = toSupabaseRange(pageable);
  const { data, error, count } = await supabase
    .from('groups')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new AppError(400, 'GROUP_LIST_FAILED', error.message);
  }

  const groups = (data ?? []) as GroupResponse[];
  const groupIds = groups.map((group) => group.id);

  if (groupIds.length === 0) {
    return toPageableResponse(groups, pageable, count ?? 0);
  }

  const { data: expenses, error: expensesError } = await supabase
    .from('expenses')
    .select('id, group_id, total_amount, paid_by_user_id')
    .in('group_id', groupIds)
    .is('deleted_at', null);

  if (expensesError) {
    throw new AppError(400, 'EXPENSE_LIST_FAILED', expensesError.message);
  }

  const { data: members, error: membersError } = await supabase
    .from('group_members')
    .select('*')
    .in('group_id', groupIds)
    .eq('status', GroupMemberStatus.Active);

  if (membersError) {
    throw new AppError(400, 'GROUP_MEMBER_LIST_FAILED', membersError.message);
  }

  const expenseRows = (expenses ?? []) as ExpenseRow[];
  const expenseIds = expenseRows.map((expense) => expense.id);
  const totalsByGroup = new Map<string, number>();
  const membersByGroup = new Map<string, string[]>();
  const splitsByExpense = new Map<string, ExpenseSplitRow[]>();

  for (const member of (members ?? []) as GroupMemberResponse[]) {
    const current = membersByGroup.get(member.group_id) ?? [];
    current.push(member.user_id);
    membersByGroup.set(member.group_id, current);
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

  const userShareByGroup = new Map<string, number>();

  for (const expense of expenseRows) {
    const amount = Number(expense.total_amount);
    totalsByGroup.set(expense.group_id, (totalsByGroup.get(expense.group_id) ?? 0) + amount);

    if (!userId) {
      continue;
    }

    const splits = splitsByExpense.get(expense.id) ?? [];
    const userSplit = splits.find((split) => split.user_id === userId);
    let userShare = 0;

    if (userSplit) {
      userShare = Number(userSplit.amount ?? 0);
    } else if (splits.length === 0) {
      const activeMemberIds = membersByGroup.get(expense.group_id) ?? [];

      if (activeMemberIds.includes(userId) && activeMemberIds.length > 0) {
        userShare = amount / activeMemberIds.length;
      }
    }

    if (userShare > 0) {
      userShareByGroup.set(
        expense.group_id,
        (userShareByGroup.get(expense.group_id) ?? 0) + userShare
      );
    }
  }

  const groupsWithTotals = groups.map((group) => ({
    ...group,
    total_amount: totalsByGroup.get(group.id) ?? 0,
    user_share_amount: userShareByGroup.get(group.id) ?? 0,
  }));

  return toPageableResponse(groupsWithTotals, pageable, count ?? 0);
}

export async function getGroup(groupId: string) {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (error || !data) {
    throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
  }

  return data as GroupResponse;
}

export async function createGroup(payload: CreateGroupRequest) {
  const name = payload.name?.trim();
  const description = payload.description?.trim() || null;
  const type = payload.type?.trim() || GroupType.Personal;
  const currency = payload.currency?.trim().toUpperCase() || GroupCurrency.VND;
  const ownerId = payload.owner_id?.trim();

  if (!name) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Group name is required');
  }

  if (!ownerId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'owner_id is required');
  }

  if (!isEnumValue(GroupType, type)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'type is invalid');
  }

  if (!isEnumValue(GroupCurrency, currency)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'currency is invalid');
  }

  const { data: group, error: groupError } = await supabase
    .from('groups')
    .insert({
      name,
      description,
      type,
      currency,
      owner_id: ownerId,
    })
    .select('*')
    .single();

  if (groupError) {
    throw new AppError(400, 'GROUP_CREATE_FAILED', groupError.message);
  }

  const { data: member, error: memberError } = await supabase
    .from('group_members')
    .insert({
      group_id: group.id,
      user_id: ownerId,
      role: GroupMemberRole.Owner,
      status: GroupMemberStatus.Active,
    })
    .select('*')
    .single();

  if (memberError) {
    await supabase.from('groups').delete().eq('id', group.id);

    throw new AppError(400, 'GROUP_MEMBER_CREATE_FAILED', memberError.message);
  }

  return {
    group: group as GroupResponse,
    member: member as GroupMemberResponse,
  };
}

export async function addGroupMember(groupId: string, payload: AddGroupMemberRequest) {
  const userId = payload.user_id?.trim();
  const role = payload.role?.trim() || GroupMemberRole.Member;
  const status = payload.status?.trim() || GroupMemberStatus.Active;

  if (!userId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'user_id is required');
  }

  if (!isEnumValue(GroupMemberRole, role)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'role is invalid');
  }

  if (!isEnumValue(GroupMemberStatus, status)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'status is invalid');
  }

  await getGroup(groupId);

  const { data, error } = await supabase
    .from('group_members')
    .insert({
      group_id: groupId,
      user_id: userId,
      role,
      status,
    })
    .select('*')
    .single();

  if (error) {
    throw new AppError(400, 'GROUP_MEMBER_CREATE_FAILED', error.message);
  }

  return data as GroupMemberResponse;
}

export async function getGroupSummary(groupId: string, month?: string) {
  const group = await getGroup(groupId);
  const targetMonth = month || new Date().toISOString().slice(0, 7);

  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'month must use YYYY-MM format');
  }

  const periodStart = `${targetMonth}-01`;
  const periodEnd = new Date(`${periodStart}T00:00:00.000Z`);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  const periodEndDate = periodEnd.toISOString().slice(0, 10);

  const { data: members, error: membersError } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', GroupMemberStatus.Active);

  if (membersError) {
    throw new AppError(400, 'GROUP_MEMBER_LIST_FAILED', membersError.message);
  }

  const activeMembers = (members ?? []) as GroupMemberResponse[];

  const { data: expenses, error: expensesError } = await supabase
    .from('expenses')
    .select('id, total_amount, paid_by_user_id')
    .eq('group_id', groupId)
    .gte('expense_date', periodStart)
    .lt('expense_date', periodEndDate)
    .is('deleted_at', null);

  if (expensesError) {
    throw new AppError(400, 'EXPENSE_LIST_FAILED', expensesError.message);
  }

  const expenseRows = (expenses ?? []) as ExpenseRow[];
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
        currency: group.currency,
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
    group,
    period_start: periodStart,
    period_end: periodEndDate,
    total_amount: totalAmount,
    currency: group.currency,
    member_balances: balances,
    settlements,
  };
}

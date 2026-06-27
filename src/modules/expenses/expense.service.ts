import { AppError } from '../../common/app-error.js';
import {
  ExpenseSplitMethod,
  GroupCurrency,
  GroupMemberRole,
  isEnumValue,
} from '../../common/enums.js';
import type { PageableRequest } from '../../common/pageable.js';
import { toPageableResponse, toSupabaseRange } from '../../common/pageable.js';
import { supabase } from '../../db/supabase.js';
import { requireGroupMember } from '../groups/group.service.js';

export type ExpenseSplitRequest = {
  user_id?: string;
  amount?: number;
  percentage?: number | null;
  shares?: number | null;
};

export type CreateExpenseRequest = {
  category_id?: string | null;
  title?: string;
  description?: string | null;
  total_amount?: number;
  currency?: string;
  paid_by_user_id?: string;
  created_by_user_id?: string;
  expense_date?: string;
  split_method?: string;
  splits?: ExpenseSplitRequest[];
};

export type UpdateExpenseRequest = Partial<CreateExpenseRequest>;

export type ExpenseResponse = {
  id: string;
  group_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  total_amount: number;
  currency: GroupCurrency;
  paid_by_user_id: string;
  created_by_user_id: string;
  expense_date: string;
  split_method: ExpenseSplitMethod;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  splits?: ExpenseSplitResponse[];
};

export type ExpenseSplitResponse = {
  user_id: string;
  amount: number | string | null;
  percentage: number | string | null;
  shares: number | string | null;
};

type ExpenseWithSplitsRow = ExpenseResponse & {
  expense_splits?: ExpenseSplitResponse[];
};

function validateCurrency(currency: string) {
  if (!isEnumValue(GroupCurrency, currency)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'currency is invalid');
  }
}

function validateSplitMethod(splitMethod: string) {
  if (!isEnumValue(ExpenseSplitMethod, splitMethod)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'split_method is invalid');
  }
}

async function ensureActiveGroupUsers(groupId: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

  if (uniqueUserIds.length === 0) {
    return;
  }

  const { data, error } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .in('user_id', uniqueUserIds);

  if (error) {
    throw new AppError(400, 'GROUP_MEMBER_LIST_FAILED', error.message);
  }

  const activeUserIds = new Set((data ?? []).map((member) => member.user_id as string));

  if (uniqueUserIds.some((userId) => !activeUserIds.has(userId))) {
    throw new AppError(
      400,
      'INVALID_EXPENSE_MEMBER',
      'Payer and split users must be active group members'
    );
  }
}

async function ensureCanManageExpense(
  groupId: string,
  expenseId: string,
  userId: string
) {
  const [member, expenseResult] = await Promise.all([
    requireGroupMember(groupId, userId),
    supabase
      .from('expenses')
      .select('id, created_by_user_id')
      .eq('id', expenseId)
      .eq('group_id', groupId)
      .is('deleted_at', null)
      .single(),
  ]);

  const { data: expense, error } = expenseResult;

  if (error || !expense) {
    throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  }

  if (
    member.role !== GroupMemberRole.Owner &&
    expense.created_by_user_id !== userId
  ) {
    throw new AppError(
      403,
      'EXPENSE_ACCESS_DENIED',
      'Only the group owner or expense creator can modify this expense'
    );
  }
}

export async function listExpenses(
  groupId: string,
  pageable: PageableRequest,
  userId: string
) {
  await requireGroupMember(groupId, userId);
  const { from, to } = toSupabaseRange(pageable);
  const { data, error, count } = await supabase
    .from('expenses')
    .select('*, expense_splits(user_id, amount, percentage, shares)', {
      count: 'exact',
    })
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('expense_date', { ascending: false })
    .range(from, to);

  if (error) {
    throw new AppError(400, 'EXPENSE_LIST_FAILED', error.message);
  }

  const expensesWithSplits = ((data ?? []) as ExpenseWithSplitsRow[]).map(
    ({ expense_splits, ...expense }) => ({
      ...expense,
      splits: expense_splits ?? [],
    })
  );

  return toPageableResponse(expensesWithSplits, pageable, count ?? 0);
}

export async function createExpense(
  groupId: string,
  payload: CreateExpenseRequest,
  actorUserId: string
) {
  await requireGroupMember(groupId, actorUserId);

  const title = payload.title?.trim();
  const totalAmount = Number(payload.total_amount);
  const currency = payload.currency?.trim().toUpperCase() || GroupCurrency.VND;
  const paidByUserId = payload.paid_by_user_id?.trim();
  const splitMethod = payload.split_method?.trim() || ExpenseSplitMethod.Equal;
  const expenseDate = payload.expense_date?.trim() || new Date().toISOString().slice(0, 10);

  if (!title) {
    throw new AppError(400, 'VALIDATION_ERROR', 'title is required');
  }

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'total_amount must be greater than 0');
  }

  if (!paidByUserId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'paid_by_user_id is required');
  }

  validateCurrency(currency);
  validateSplitMethod(splitMethod);
  await ensureActiveGroupUsers(groupId, [
    paidByUserId,
    ...(payload.splits ?? []).map((split) => split.user_id ?? ''),
  ]);

  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({
      group_id: groupId,
      category_id: payload.category_id || null,
      title,
      description: payload.description?.trim() || null,
      total_amount: totalAmount,
      currency,
      paid_by_user_id: paidByUserId,
      created_by_user_id: actorUserId,
      expense_date: expenseDate,
      split_method: splitMethod,
    })
    .select('*')
    .single();

  if (error) {
    throw new AppError(400, 'EXPENSE_CREATE_FAILED', error.message);
  }

  if (payload.splits?.length) {
    const splitRows = payload.splits.map((split) => {
      if (!split.user_id) {
        throw new AppError(400, 'VALIDATION_ERROR', 'split user_id is required');
      }

      return {
        expense_id: expense.id,
        user_id: split.user_id,
        amount: split.amount ?? null,
        percentage: split.percentage ?? null,
        shares: split.shares ?? null,
      };
    });

    const { error: splitError } = await supabase.from('expense_splits').insert(splitRows);

    if (splitError) {
      await supabase.from('expenses').delete().eq('id', expense.id);
      throw new AppError(400, 'EXPENSE_SPLIT_CREATE_FAILED', splitError.message);
    }
  }

  return expense as ExpenseResponse;
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  payload: UpdateExpenseRequest,
  actorUserId: string
) {
  await ensureCanManageExpense(groupId, expenseId, actorUserId);
  const updates: Record<string, unknown> = {};

  if (payload.category_id !== undefined) {
    updates.category_id = payload.category_id;
  }
  if (payload.title !== undefined) {
    const title = payload.title.trim();
    if (!title) {
      throw new AppError(400, 'VALIDATION_ERROR', 'title is required');
    }
    updates.title = title;
  }
  if (payload.description !== undefined) {
    updates.description = payload.description?.trim() || null;
  }
  if (payload.total_amount !== undefined) {
    const totalAmount = Number(payload.total_amount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'total_amount must be greater than 0');
    }
    updates.total_amount = totalAmount;
  }
  if (payload.currency !== undefined) {
    const currency = payload.currency.trim().toUpperCase();
    validateCurrency(currency);
    updates.currency = currency;
  }
  if (payload.paid_by_user_id !== undefined) {
    await ensureActiveGroupUsers(groupId, [payload.paid_by_user_id]);
    updates.paid_by_user_id = payload.paid_by_user_id;
  }
  if (payload.expense_date !== undefined) {
    updates.expense_date = payload.expense_date;
  }
  if (payload.split_method !== undefined) {
    const splitMethod = payload.split_method.trim();
    validateSplitMethod(splitMethod);
    updates.split_method = splitMethod;
  }

  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', expenseId)
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  }

  if (payload.splits) {
    await ensureActiveGroupUsers(
      groupId,
      payload.splits.map((split) => split.user_id ?? '')
    );
    await supabase.from('expense_splits').delete().eq('expense_id', expenseId);

    if (payload.splits.length > 0) {
      const splitRows = payload.splits.map((split) => ({
        expense_id: expenseId,
        user_id: split.user_id,
        amount: split.amount ?? null,
        percentage: split.percentage ?? null,
        shares: split.shares ?? null,
      }));
      const { error: splitError } = await supabase.from('expense_splits').insert(splitRows);

      if (splitError) {
        throw new AppError(400, 'EXPENSE_SPLIT_UPDATE_FAILED', splitError.message);
      }
    }
  }

  return data as ExpenseResponse;
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  actorUserId: string
) {
  await ensureCanManageExpense(groupId, expenseId, actorUserId);
  const { data, error } = await supabase
    .from('expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', expenseId)
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .select('id')
    .single();

  if (error || !data) {
    throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  }

  return { id: expenseId };
}

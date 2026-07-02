import { AppError } from '../../common/app-error.js';
import {
  ExpenseSplitMethod,
  WalletCurrency,
  WalletMemberRole,
  isEnumValue,
} from '../../common/enums.js';
import type { PageableRequest } from '../../common/pageable.js';
import { toPageableResponse, toSupabaseRange } from '../../common/pageable.js';
import {
  deleteObject,
  uploadExpenseAttachment,
} from '../../common/object-storage.js';
import { supabase } from '../../db/supabase.js';
import { requireWalletMember } from '../wallets/wallet.service.js';

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
  wallet_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  total_amount: number;
  currency: WalletCurrency;
  paid_by_user_id: string;
  created_by_user_id: string;
  expense_date: string;
  split_method: ExpenseSplitMethod;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  splits?: ExpenseSplitResponse[];
  attachments?: AttachmentResponse[];
};

export type AttachmentResponse = {
  id: string;
  expense_id: string;
  file_url: string;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_by_user_id: string;
  created_at: string;
};

export type ExpenseSplitResponse = {
  user_id: string;
  amount: number | string | null;
  percentage: number | string | null;
  shares: number | string | null;
};

type ExpenseWithSplitsRow = ExpenseResponse & {
  expense_splits?: ExpenseSplitResponse[];
  attachments?: AttachmentResponse[];
};

function validateCurrency(currency: string) {
  if (!isEnumValue(WalletCurrency, currency)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'currency is invalid');
  }
}

function validateSplitMethod(splitMethod: string) {
  if (!isEnumValue(ExpenseSplitMethod, splitMethod)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'split_method is invalid');
  }
}

async function ensureActiveWalletUsers(walletId: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

  if (uniqueUserIds.length === 0) {
    return;
  }

  const { data, error } = await supabase
    .from('wallet_members')
    .select('user_id')
    .eq('wallet_id', walletId)
    .eq('status', 'active')
    .in('user_id', uniqueUserIds);

  if (error) {
    throw new AppError(400, 'WALLET_MEMBER_LIST_FAILED', error.message);
  }

  const activeUserIds = new Set((data ?? []).map((member) => member.user_id as string));

  if (uniqueUserIds.some((userId) => !activeUserIds.has(userId))) {
    throw new AppError(
      400,
      'INVALID_EXPENSE_MEMBER',
      'Payer and split users must be active wallet members'
    );
  }
}

async function ensureCanManageExpense(
  walletId: string,
  expenseId: string,
  userId: string
) {
  const [member, expenseResult] = await Promise.all([
    requireWalletMember(walletId, userId),
    supabase
      .from('expenses')
      .select('id, created_by_user_id')
      .eq('id', expenseId)
      .eq('wallet_id', walletId)
      .is('deleted_at', null)
      .single(),
  ]);

  const { data: expense, error } = expenseResult;

  if (error || !expense) {
    throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  }

  if (
    member.role !== WalletMemberRole.Owner &&
    expense.created_by_user_id !== userId
  ) {
    throw new AppError(
      403,
      'EXPENSE_ACCESS_DENIED',
      'Only the wallet owner or expense creator can modify this expense'
    );
  }
}

export async function listExpenses(
  walletId: string,
  pageable: PageableRequest,
  userId: string,
  month?: string
) {
  await requireWalletMember(walletId, userId);
  const { from, to } = toSupabaseRange(pageable);
  let query = supabase
    .from('expenses')
    .select(
      '*, expense_splits(user_id, amount, percentage, shares), attachments(id, expense_id, file_url, file_path, file_name, file_type, file_size, uploaded_by_user_id, created_at)',
      { count: 'exact' }
    )
    .eq('wallet_id', walletId)
    .is('deleted_at', null);

  if (month !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'month must use YYYY-MM format');
    }

    const [year, monthNumber] = month.split('-').map(Number);
    const periodStart = `${month}-01`;
    const periodEnd = new Date(Date.UTC(year, monthNumber, 1))
      .toISOString()
      .slice(0, 10);

    query = query.gte('expense_date', periodStart).lt('expense_date', periodEnd);
  }

  const { data, error, count } = await query
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new AppError(400, 'EXPENSE_LIST_FAILED', error.message);
  }

  const expensesWithSplits = ((data ?? []) as ExpenseWithSplitsRow[]).map(
    ({ expense_splits, attachments, ...expense }) => ({
      ...expense,
      splits: expense_splits ?? [],
      attachments: attachments ?? [],
    })
  );

  return toPageableResponse(expensesWithSplits, pageable, count ?? 0);
}

export async function createExpense(
  walletId: string,
  payload: CreateExpenseRequest,
  actorUserId: string
) {
  await requireWalletMember(walletId, actorUserId);

  const title = payload.title?.trim();
  const totalAmount = Number(payload.total_amount);
  const currency = payload.currency?.trim().toUpperCase() || WalletCurrency.VND;
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
  await ensureActiveWalletUsers(walletId, [
    paidByUserId,
    ...(payload.splits ?? []).map((split) => split.user_id ?? ''),
  ]);

  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({
      wallet_id: walletId,
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
  walletId: string,
  expenseId: string,
  payload: UpdateExpenseRequest,
  actorUserId: string
) {
  await ensureCanManageExpense(walletId, expenseId, actorUserId);
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
    await ensureActiveWalletUsers(walletId, [payload.paid_by_user_id]);
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
    .eq('wallet_id', walletId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  }

  if (payload.splits) {
    await ensureActiveWalletUsers(
      walletId,
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
  walletId: string,
  expenseId: string,
  actorUserId: string
) {
  await ensureCanManageExpense(walletId, expenseId, actorUserId);
  const { data, error } = await supabase
    .from('expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', expenseId)
    .eq('wallet_id', walletId)
    .is('deleted_at', null)
    .select('id')
    .single();

  if (error || !data) {
    throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  }

  return { id: expenseId };
}

export async function createExpenseAttachment(
  walletId: string,
  expenseId: string,
  actorUserId: string,
  file: Express.Multer.File
) {
  await ensureCanManageExpense(walletId, expenseId, actorUserId);
  const uploaded = await uploadExpenseAttachment(walletId, expenseId, file);
  const { data, error } = await supabase
    .from('attachments')
    .insert({
      expense_id: expenseId,
      file_url: uploaded.url,
      file_path: uploaded.key,
      file_name: file.originalname,
      file_type: file.mimetype,
      file_size: file.size,
      uploaded_by_user_id: actorUserId,
    })
    .select('*')
    .single();

  if (error || !data) {
    try {
      await deleteObject(uploaded.key);
    } catch {
      // Keep the database error as the primary failure.
    }
    throw new AppError(400, 'ATTACHMENT_CREATE_FAILED', error?.message || 'Attachment create failed');
  }

  return data as AttachmentResponse;
}

export async function deleteExpenseAttachment(
  walletId: string,
  expenseId: string,
  attachmentId: string,
  actorUserId: string
) {
  await ensureCanManageExpense(walletId, expenseId, actorUserId);
  const { data: attachment, error: findError } = await supabase
    .from('attachments')
    .select('id, file_path')
    .eq('id', attachmentId)
    .eq('expense_id', expenseId)
    .single();

  if (findError || !attachment) {
    throw new AppError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');
  }

  const { error: deleteError } = await supabase
    .from('attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('expense_id', expenseId);

  if (deleteError) {
    throw new AppError(400, 'ATTACHMENT_DELETE_FAILED', deleteError.message);
  }

  await deleteObject(attachment.file_path as string);
  return { id: attachmentId };
}

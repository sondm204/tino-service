import { AppError } from '../../common/app-error.js';
import {
  ExpenseSplitMethod,
  WalletCurrency,
  WalletType,
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
import {
  createNotifications,
  type NotificationType,
} from '../notification/notification.service.js';
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
  notify_telegram?: boolean;
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

export type RecentExpenseResponse = ExpenseResponse & {
  wallet_name: string;
};

export type ReceiptExpenseDraftResponse = {
  title: string;
  description: string | null;
  total_amount: number | null;
  expense_date: string;
  merchant_name: string | null;
  confidence: number | null;
  source: {
    model_id: string;
    api_version: string;
  };
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

type RecentExpenseRow = ExpenseResponse & {
  wallet?: {
    name?: string;
  };
};

type AzureReceiptField = {
  content?: string;
  confidence?: number;
  valueString?: string;
  valueDate?: string;
  valueNumber?: number;
  valueCurrency?: {
    amount?: number;
    currencyCode?: string;
  };
  valueArray?: Array<{
    valueObject?: Record<string, AzureReceiptField>;
  }>;
};

type AzureAnalyzeResult = {
  status?: string;
  analyzeResult?: {
    documents?: Array<{
      confidence?: number;
      fields?: Record<string, AzureReceiptField>;
    }>;
  };
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

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getAzureConfig() {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.replace(/\/+$/, '');
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  const apiVersion =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || '2024-11-30';

  if (!endpoint || !key) {
    throw new AppError(
      503,
      'DOCUMENT_INTELLIGENCE_NOT_CONFIGURED',
      'Azure Document Intelligence is not configured'
    );
  }

  return { endpoint, key, apiVersion };
}

function fieldText(field?: AzureReceiptField) {
  return field?.valueString?.trim() || field?.content?.trim() || null;
}

function parseCurrencyText(value?: string) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const amount = Number(normalized);

  return Number.isFinite(amount) ? amount : null;
}

function fieldAmount(field?: AzureReceiptField) {
  const amount = field?.valueCurrency?.amount ?? field?.valueNumber;

  if (Number.isFinite(amount)) {
    return Number(amount);
  }

  return parseCurrencyText(field?.content);
}

function fieldDate(field?: AzureReceiptField) {
  const value = field?.valueDate || field?.content;

  if (!value) {
    return null;
  }

  const isoDate = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];

  if (isoDate) {
    return isoDate;
  }

  const vietnameseDate = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);

  if (!vietnameseDate) {
    return null;
  }

  const day = vietnameseDate[1].padStart(2, '0');
  const month = vietnameseDate[2].padStart(2, '0');
  const year =
    vietnameseDate[3].length === 2
      ? `20${vietnameseDate[3]}`
      : vietnameseDate[3];

  return `${year}-${month}-${day}`;
}

async function analyzeReceiptWithAzure(
  file: Express.Multer.File
): Promise<AzureAnalyzeResult> {
  const { endpoint, key, apiVersion } = getAzureConfig();
  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=${apiVersion}`;
  const analyzeResponse = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': file.mimetype || 'application/octet-stream',
      'Ocp-Apim-Subscription-Key': key,
    },
    body: new Uint8Array(file.buffer),
  });

  if (!analyzeResponse.ok) {
    const message = await analyzeResponse.text();
    throw new AppError(
      502,
      'RECEIPT_ANALYZE_FAILED',
      message || 'Could not analyze receipt'
    );
  }

  const operationLocation = analyzeResponse.headers.get('operation-location');

  if (!operationLocation) {
    throw new AppError(
      502,
      'RECEIPT_ANALYZE_FAILED',
      'Azure did not return an operation location'
    );
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(attempt === 0 ? 800 : 1000);

    const resultResponse = await fetch(operationLocation, {
      headers: {
        'Ocp-Apim-Subscription-Key': key,
      },
    });

    if (!resultResponse.ok) {
      const message = await resultResponse.text();
      throw new AppError(
        502,
        'RECEIPT_ANALYZE_FAILED',
        message || 'Could not read receipt analysis result'
      );
    }

    const result = (await resultResponse.json()) as AzureAnalyzeResult;

    if (result.status === 'succeeded') {
      return result;
    }

    if (result.status === 'failed') {
      throw new AppError(
        422,
        'RECEIPT_ANALYZE_FAILED',
        'Azure could not analyze this receipt'
      );
    }
  }

  throw new AppError(
    504,
    'RECEIPT_ANALYZE_TIMEOUT',
    'Receipt analysis took too long'
  );
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

async function notifyWalletMembers(input: {
  walletId: string;
  actorUserId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}) {
  const { data, error } = await supabase
    .from('wallet_members')
    .select('user_id')
    .eq('wallet_id', input.walletId)
    .eq('status', 'active')
    .neq('user_id', input.actorUserId);

  if (error) {
    console.error('Could not resolve notification recipients', error.message);
    return;
  }

  try {
    await createNotifications(
      (data ?? []).map((member) => ({
        user_id: member.user_id as string,
        created_by: input.actorUserId,
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: input.metadata,
      }))
    );
  } catch (error) {
    console.error('Could not create expense notifications', error);
  }
}

async function notifyTelegramGroupExpenseCreated(input: {
  walletId: string;
  actorUserId: string;
  paidByUserId: string;
  title: string;
  totalAmount: number;
  currency: string;
  expenseDate: string;
}) {
  const telebotBaseUrl = process.env.TINO_TELEBOT_BASE_URL?.replace(/\/+$/, '');
  const serviceSecret = process.env.TELEGRAM_BOT_SERVICE_SECRET;

  if (!telebotBaseUrl || !serviceSecret) {
    return;
  }

  try {
    const [walletResult, connectionResult, usersResult] = await Promise.all([
      supabase
        .from('wallets')
        .select('id, name, type')
        .eq('id', input.walletId)
        .is('deleted_at', null)
        .single(),
      supabase
        .from('telegram_chat_wallets')
        .select('telegram_chat_id')
        .eq('wallet_id', input.walletId)
        .maybeSingle(),
      supabase
        .from('users')
        .select('id, email, display_name')
        .in('id', [input.actorUserId, input.paidByUserId]),
    ]);

    const { data: wallet, error: walletError } = walletResult;

    if (walletError || !wallet || wallet.type !== WalletType.Shared) {
      return;
    }

    const { data: connection, error: connectionError } = connectionResult;

    if (connectionError || !connection) {
      return;
    }

    const userById = new Map(
      (usersResult.data ?? []).map((user) => [
        user.id as string,
        (user.display_name as string | null) || (user.email as string | null) || user.id,
      ])
    );
    const response = await fetch(`${telebotBaseUrl}/internal/telegram/expense-created`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tino-bot-secret': serviceSecret,
      },
      body: JSON.stringify({
        telegram_chat_id: String(connection.telegram_chat_id),
        wallet_name: wallet.name,
        actor_name: userById.get(input.actorUserId) || input.actorUserId,
        payer_name: userById.get(input.paidByUserId) || input.paidByUserId,
        title: input.title,
        total_amount: input.totalAmount,
        currency: input.currency,
        expense_date: input.expenseDate,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(
        'Could not send Telegram expense notification',
        await response.text().catch(() => response.statusText)
      );
    }
  } catch (error) {
    console.error('Could not send Telegram expense notification', error);
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

export async function listRecentExpenses(userId: string, size = 3) {
  const normalizedSize = Math.min(Math.max(Math.trunc(size) || 3, 1), 10);
  const { data: memberships, error: membershipError } = await supabase
    .from('wallet_members')
    .select('wallet_id')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (membershipError) {
    throw new AppError(400, 'WALLET_MEMBER_LIST_FAILED', membershipError.message);
  }

  const walletIds = (memberships ?? []).map(
    (membership) => membership.wallet_id as string
  );

  if (walletIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('expenses')
    .select(
      '*, wallet:wallets!inner(name), expense_splits(user_id, amount, percentage, shares), attachments(id, expense_id, file_url, file_path, file_name, file_type, file_size, uploaded_by_user_id, created_at)'
    )
    .in('wallet_id', walletIds)
    .is('deleted_at', null)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(normalizedSize);

  if (error) {
    throw new AppError(400, 'EXPENSE_LIST_FAILED', error.message);
  }

  return ((data ?? []) as Array<
    RecentExpenseRow & {
      expense_splits?: ExpenseSplitResponse[];
      attachments?: AttachmentResponse[];
    }
  >).map(({ wallet, expense_splits, attachments, ...expense }) => ({
    ...expense,
    wallet_name: wallet?.name || '',
    splits: expense_splits ?? [],
    attachments: attachments ?? [],
  })) as RecentExpenseResponse[];
}

export async function createReceiptExpenseDraft(
  walletId: string,
  file: Express.Multer.File,
  actorUserId: string
): Promise<ReceiptExpenseDraftResponse> {
  await requireWalletMember(walletId, actorUserId);

  if (!file.buffer?.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'receipt file is required');
  }

  const apiVersion =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION || '2024-11-30';
  const result = await analyzeReceiptWithAzure(file);
  const document = result.analyzeResult?.documents?.[0];
  const fields = document?.fields ?? {};
  const merchantName = fieldText(fields.MerchantName);
  const totalAmount =
    fieldAmount(fields.Total) ??
    fieldAmount(fields.TotalPrice) ??
    fieldAmount(fields.SubTotal);
  const expenseDate =
    fieldDate(fields.TransactionDate) ||
    fieldDate(fields.ReceiptDate) ||
    new Date().toISOString().slice(0, 10);
  return {
    title: 'Mua sắm',
    description: null,
    total_amount: totalAmount,
    expense_date: expenseDate,
    merchant_name: merchantName,
    confidence: document?.confidence ?? null,
    source: {
      model_id: 'prebuilt-receipt',
      api_version: apiVersion,
    },
  };
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

  await notifyWalletMembers({
    walletId,
    actorUserId,
    type: 'EXPENSE_CREATED',
    title: 'Khoản chi mới',
    message: `${title}: ${totalAmount.toLocaleString('vi-VN')} ${currency}`,
    metadata: {
      wallet_id: walletId,
      expense_id: expense.id,
    },
  });

  if (payload.notify_telegram !== false) {
    await notifyTelegramGroupExpenseCreated({
      walletId,
      actorUserId,
      paidByUserId,
      title,
      totalAmount,
      currency,
      expenseDate,
    });
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

  await notifyWalletMembers({
    walletId,
    actorUserId,
    type: 'EXPENSE_UPDATED',
    title: 'Khoản chi đã cập nhật',
    message: `${data.title}: ${Number(data.total_amount).toLocaleString('vi-VN')} ${data.currency}`,
    metadata: {
      wallet_id: walletId,
      expense_id: expenseId,
    },
  });

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
  const [attachment] = await createExpenseAttachments(
    walletId,
    expenseId,
    actorUserId,
    [file]
  );

  return attachment;
}

export async function createExpenseAttachments(
  walletId: string,
  expenseId: string,
  actorUserId: string,
  files: Express.Multer.File[]
) {
  await ensureCanManageExpense(walletId, expenseId, actorUserId);

  if (files.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'attachment file is required');
  }

  const uploadedFiles: Array<{
    file: Express.Multer.File;
    uploaded: { key: string; url: string };
  }> = [];

  try {
    for (const file of files) {
      uploadedFiles.push({
        file,
        uploaded: await uploadExpenseAttachment(walletId, expenseId, file),
      });
    }
  } catch (error) {
    await Promise.allSettled(
      uploadedFiles.map(({ uploaded }) => deleteObject(uploaded.key))
    );
    throw error;
  }

  const { data, error } = await supabase
    .from('attachments')
    .insert(
      uploadedFiles.map(({ file, uploaded }) => ({
        expense_id: expenseId,
        file_url: uploaded.url,
        file_path: uploaded.key,
        file_name: file.originalname,
        file_type: file.mimetype,
        file_size: file.size,
        uploaded_by_user_id: actorUserId,
      }))
    )
    .select('*')
    .order('created_at', { ascending: true });

  if (error || !data) {
    await Promise.allSettled(
      uploadedFiles.map(({ uploaded }) => deleteObject(uploaded.key))
    );
    throw new AppError(400, 'ATTACHMENT_CREATE_FAILED', error?.message || 'Attachment create failed');
  }

  return data as AttachmentResponse[];
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

import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { ExpenseSplitMethod, WalletMemberStatus } from '../../common/enums.js';
import { supabase } from '../../db/supabase.js';
import {
  createExpense,
  createExpenseAttachment,
} from '../expenses/expense.service.js';
import {
  getWallet,
  getMonthPeriod,
  getWalletSummary,
  listWalletMembers,
  requireWalletMember,
  requireWalletOwner,
} from '../wallets/wallet.service.js';

const CODE_TTL_MINUTES = 10;

type TelegramIdentity = {
  telegram_user_id?: string;
  telegram_username?: string | null;
  telegram_display_name?: string | null;
};

type LinkTelegramRequest = TelegramIdentity & {
  code?: string;
};

type ConnectTelegramChatRequest = TelegramIdentity & {
  code?: string;
  telegram_chat_id?: string;
  telegram_chat_title?: string | null;
};

type TelegramContextRequest = {
  telegram_user_id?: string;
  telegram_chat_id?: string;
};

type TelegramSummaryRequest = TelegramContextRequest & {
  month?: string;
};

type TelegramPersonalSummaryRequest = {
  telegram_user_id?: string;
  month?: string;
};

type CreateTelegramExpenseRequest = TelegramContextRequest & {
  title?: string;
  total_amount?: number;
  expense_date?: string;
};

type TelegramAccountRow = {
  user_id: string;
  telegram_user_id: number | string;
};

type TelegramExpenseSplitRow = {
  expense_id: string;
  user_id: string;
  amount: number | string | null;
};

function normalizeTelegramId(value: string | undefined, field: string) {
  const normalized = value?.trim();

  if (!normalized || !/^-?\d+$/.test(normalized)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} is invalid`);
  }

  return normalized;
}

function normalizeCode(value: string | undefined) {
  const code = value?.trim().toUpperCase();

  if (!code || !/^[A-Z0-9]{8}$/.test(code)) {
    throw new AppError(400, 'INVALID_TELEGRAM_CODE', 'Code is invalid');
  }

  return code;
}

function generateCode() {
  return randomBytes(6)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase()
    .padEnd(8, '0');
}

function codeExpiry() {
  return new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
}

async function createUniqueCode(
  table: 'telegram_link_codes' | 'telegram_wallet_connect_codes',
  values: Record<string, unknown>
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const expiresAt = codeExpiry();
    const { error } = await supabase.from(table).insert({
      ...values,
      code,
      expires_at: expiresAt,
    });

    if (!error) {
      return { code, expires_at: expiresAt };
    }

    if (error.code !== '23505') {
      throw new AppError(400, 'TELEGRAM_CODE_CREATE_FAILED', error.message);
    }
  }

  throw new AppError(
    500,
    'TELEGRAM_CODE_CREATE_FAILED',
    'Could not generate a unique code'
  );
}

export async function createTelegramLinkCode(userId: string) {
  await supabase
    .from('telegram_link_codes')
    .delete()
    .eq('user_id', userId)
    .is('consumed_at', null);

  return createUniqueCode('telegram_link_codes', { user_id: userId });
}

export async function createTelegramWalletConnectCode(
  walletId: string,
  userId: string
) {
  await requireWalletOwner(walletId, userId);
  await supabase
    .from('telegram_wallet_connect_codes')
    .delete()
    .eq('wallet_id', walletId)
    .is('consumed_at', null);

  return createUniqueCode('telegram_wallet_connect_codes', {
    wallet_id: walletId,
    created_by_user_id: userId,
  });
}

export async function linkTelegramAccount(payload: LinkTelegramRequest) {
  const code = normalizeCode(payload.code);
  const telegramUserId = normalizeTelegramId(
    payload.telegram_user_id,
    'telegram_user_id'
  );
  const { data: linkCode, error: codeError } = await supabase
    .from('telegram_link_codes')
    .select('id, user_id, expires_at')
    .eq('code', code)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (codeError || !linkCode) {
    throw new AppError(
      400,
      'INVALID_TELEGRAM_CODE',
      'Code is invalid or expired'
    );
  }

  const { data: existing } = await supabase
    .from('telegram_accounts')
    .select('user_id, telegram_user_id')
    .or(`user_id.eq.${linkCode.user_id},telegram_user_id.eq.${telegramUserId}`)
    .maybeSingle();

  if (
    existing &&
    (existing.user_id !== linkCode.user_id ||
      String(existing.telegram_user_id) !== telegramUserId)
  ) {
    throw new AppError(
      409,
      'TELEGRAM_ACCOUNT_ALREADY_LINKED',
      'This Telegram or Tino account is already linked'
    );
  }

  const { data, error } = await supabase
    .from('telegram_accounts')
    .upsert(
      {
        user_id: linkCode.user_id,
        telegram_user_id: telegramUserId,
        telegram_username: payload.telegram_username?.trim() || null,
        telegram_display_name:
          payload.telegram_display_name?.trim() || null,
      },
      { onConflict: 'user_id' }
    )
    .select('user_id, telegram_user_id, telegram_username, telegram_display_name')
    .single();

  if (error || !data) {
    throw new AppError(
      400,
      'TELEGRAM_ACCOUNT_LINK_FAILED',
      error?.message || 'Could not link Telegram account'
    );
  }

  await supabase
    .from('telegram_link_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', linkCode.id)
    .is('consumed_at', null);

  return data;
}

async function getTelegramAccount(telegramUserId: string) {
  const { data, error } = await supabase
    .from('telegram_accounts')
    .select('user_id, telegram_user_id')
    .eq('telegram_user_id', telegramUserId)
    .single();

  if (error || !data) {
    throw new AppError(
      403,
      'TELEGRAM_ACCOUNT_NOT_LINKED',
      'Telegram account is not linked'
    );
  }

  return data as TelegramAccountRow;
}

export async function connectTelegramChat(
  payload: ConnectTelegramChatRequest
) {
  const code = normalizeCode(payload.code);
  const telegramUserId = normalizeTelegramId(
    payload.telegram_user_id,
    'telegram_user_id'
  );
  const telegramChatId = normalizeTelegramId(
    payload.telegram_chat_id,
    'telegram_chat_id'
  );
  const account = await getTelegramAccount(telegramUserId);
  const { data: connectCode, error: codeError } = await supabase
    .from('telegram_wallet_connect_codes')
    .select('id, wallet_id, created_by_user_id, expires_at')
    .eq('code', code)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (codeError || !connectCode) {
    throw new AppError(
      400,
      'INVALID_TELEGRAM_CODE',
      'Code is invalid or expired'
    );
  }

  if (connectCode.created_by_user_id !== account.user_id) {
    throw new AppError(
      403,
      'TELEGRAM_CONNECT_DENIED',
      'Connect code does not belong to this account'
    );
  }

  await requireWalletOwner(connectCode.wallet_id, account.user_id);
  const { data, error } = await supabase
    .from('telegram_chat_wallets')
    .upsert(
      {
        telegram_chat_id: telegramChatId,
        wallet_id: connectCode.wallet_id,
        telegram_chat_title: payload.telegram_chat_title?.trim() || null,
        connected_by_user_id: account.user_id,
      },
      { onConflict: 'telegram_chat_id' }
    )
    .select('telegram_chat_id, wallet_id, telegram_chat_title')
    .single();

  if (error || !data) {
    const code =
      error?.code === '23505'
        ? 'WALLET_ALREADY_CONNECTED'
        : 'TELEGRAM_CHAT_CONNECT_FAILED';
    throw new AppError(
      error?.code === '23505' ? 409 : 400,
      code,
      error?.message || 'Could not connect Telegram chat'
    );
  }

  await supabase
    .from('telegram_wallet_connect_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', connectCode.id)
    .is('consumed_at', null);

  return { ...data, wallet: await getWallet(connectCode.wallet_id) };
}

export async function disconnectTelegramChat(payload: TelegramContextRequest) {
  const context = await resolveTelegramContext(payload);
  await requireWalletOwner(
    context.connection.wallet_id,
    context.account.user_id
  );

  const { error } = await supabase
    .from('telegram_chat_wallets')
    .delete()
    .eq('telegram_chat_id', context.connection.telegram_chat_id)
    .eq('wallet_id', context.connection.wallet_id);

  if (error) {
    throw new AppError(
      400,
      'TELEGRAM_CHAT_DISCONNECT_FAILED',
      error.message
    );
  }

  return {
    telegram_chat_id: context.connection.telegram_chat_id,
    wallet: context.wallet,
  };
}

async function resolveTelegramContext(payload: TelegramContextRequest) {
  const telegramUserId = normalizeTelegramId(
    payload.telegram_user_id,
    'telegram_user_id'
  );
  const telegramChatId = normalizeTelegramId(
    payload.telegram_chat_id,
    'telegram_chat_id'
  );
  const account = await getTelegramAccount(telegramUserId);
  const { data: connection, error } = await supabase
    .from('telegram_chat_wallets')
    .select('wallet_id, telegram_chat_id, telegram_chat_title')
    .eq('telegram_chat_id', telegramChatId)
    .single();

  if (error || !connection) {
    throw new AppError(
      404,
      'TELEGRAM_CHAT_NOT_CONNECTED',
      'Telegram chat is not connected to a wallet'
    );
  }

  await requireWalletMember(connection.wallet_id, account.user_id);
  return {
    account,
    connection,
    wallet: await getWallet(connection.wallet_id),
  };
}

export async function getTelegramContext(payload: TelegramContextRequest) {
  const context = await resolveTelegramContext(payload);
  const members = await listWalletMembers(
    context.connection.wallet_id,
    context.account.user_id
  );

  return {
    wallet: context.wallet,
    telegram_chat_id: context.connection.telegram_chat_id,
    telegram_chat_title: context.connection.telegram_chat_title,
    current_user_id: context.account.user_id,
    members: members.map((member) => ({
      user_id: member.user_id,
      display_name: member.user.display_name,
      telegram_linked: false,
    })),
  };
}

export async function getTelegramSummary(payload: TelegramSummaryRequest) {
  const context = await resolveTelegramContext(payload);

  return getWalletSummary(
    context.connection.wallet_id,
    payload.month,
    context.account.user_id
  );
}

export async function getTelegramPersonalSummary(
  payload: TelegramPersonalSummaryRequest
) {
  const telegramUserId = normalizeTelegramId(
    payload.telegram_user_id,
    'telegram_user_id'
  );
  const account = await getTelegramAccount(telegramUserId);
  const { periodStart, periodEndDate } = getMonthPeriod(payload.month);
  const { data: memberWallets, error: memberWalletsError } = await supabase
    .from('wallet_members')
    .select(
      `
        wallet_id,
        wallet:wallets!inner (
          id,
          name,
          currency,
          deleted_at
        )
      `
    )
    .eq('user_id', account.user_id)
    .eq('status', WalletMemberStatus.Active)
    .is('wallet.deleted_at', null);

  if (memberWalletsError) {
    throw new AppError(
      400,
      'TELEGRAM_PERSONAL_SUMMARY_FAILED',
      memberWalletsError.message
    );
  }

  const wallets = ((memberWallets ?? []) as unknown as Array<{
    wallet_id: string;
    wallet: {
      id: string;
      name: string;
      currency: string;
      deleted_at: string | null;
    };
  }>).map((item) => item.wallet);
  const walletIds = wallets.map((wallet) => wallet.id);

  if (walletIds.length === 0) {
    return {
      period_start: periodStart,
      period_end: periodEndDate,
      totals_by_currency: [],
      wallets: [],
    };
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
      .select('wallet_id, user_id')
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

  const expenseRows = (expenses ?? []) as Array<{
    id: string;
    wallet_id: string;
    total_amount: number | string;
    paid_by_user_id: string;
  }>;
  const expenseIds = expenseRows.map((expense) => expense.id);
  const splitsByExpense = new Map<string, TelegramExpenseSplitRow[]>();
  const membersByWallet = new Map<string, string[]>();

  for (const member of (members ?? []) as Array<{
    wallet_id: string;
    user_id: string;
  }>) {
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

    for (const split of (splits ?? []) as TelegramExpenseSplitRow[]) {
      const current = splitsByExpense.get(split.expense_id) ?? [];
      current.push(split);
      splitsByExpense.set(split.expense_id, current);
    }
  }

  const walletSummaryById = new Map(
    wallets.map((wallet) => [
      wallet.id,
      {
        wallet_id: wallet.id,
        wallet_name: wallet.name,
        currency: wallet.currency,
        total_amount: 0,
        paid_amount: 0,
        share_amount: 0,
      },
    ])
  );

  for (const expense of expenseRows) {
    const walletSummary = walletSummaryById.get(expense.wallet_id);

    if (!walletSummary) continue;

    const amount = Number(expense.total_amount);
    walletSummary.total_amount += amount;

    if (expense.paid_by_user_id === account.user_id) {
      walletSummary.paid_amount += amount;
    }

    const splits = splitsByExpense.get(expense.id) ?? [];
    const userSplit = splits.find((split) => split.user_id === account.user_id);

    if (userSplit) {
      walletSummary.share_amount += Number(userSplit.amount ?? 0);
    } else if (splits.length === 0) {
      const activeMemberIds = membersByWallet.get(expense.wallet_id) ?? [];

      if (activeMemberIds.includes(account.user_id) && activeMemberIds.length > 0) {
        walletSummary.share_amount += amount / activeMemberIds.length;
      }
    }
  }

  const totalsByCurrency = new Map<
    string,
    {
      currency: string;
      total_amount: number;
      paid_amount: number;
      share_amount: number;
    }
  >();

  for (const walletSummary of walletSummaryById.values()) {
    const total = totalsByCurrency.get(walletSummary.currency) ?? {
      currency: walletSummary.currency,
      total_amount: 0,
      paid_amount: 0,
      share_amount: 0,
    };

    total.total_amount += walletSummary.total_amount;
    total.paid_amount += walletSummary.paid_amount;
    total.share_amount += walletSummary.share_amount;
    totalsByCurrency.set(walletSummary.currency, total);
  }

  return {
    period_start: periodStart,
    period_end: periodEndDate,
    totals_by_currency: Array.from(totalsByCurrency.values()),
    wallets: Array.from(walletSummaryById.values()),
  };
}

export async function createTelegramExpense(
  payload: CreateTelegramExpenseRequest
) {
  const context = await resolveTelegramContext(payload);
  const title = payload.title?.trim();
  const totalAmount = Number(payload.total_amount);

  if (!title) {
    throw new AppError(400, 'VALIDATION_ERROR', 'title is required');
  }

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'total_amount must be greater than 0'
    );
  }

  const expense = await createExpense(
    context.connection.wallet_id,
    {
      title,
      total_amount: totalAmount,
      currency: context.wallet.currency,
      paid_by_user_id: context.account.user_id,
      expense_date: payload.expense_date,
      split_method: ExpenseSplitMethod.Equal,
    },
    context.account.user_id
  );

  return {
    ...expense,
    wallet_name: context.wallet.name,
    member_status: WalletMemberStatus.Active,
  };
}

export async function createTelegramExpenseAttachment(
  expenseId: string,
  payload: TelegramContextRequest,
  file: Express.Multer.File
) {
  const context = await resolveTelegramContext(payload);
  const { data: expense, error } = await supabase
    .from('expenses')
    .select('id, created_by_user_id')
    .eq('id', expenseId)
    .eq('wallet_id', context.connection.wallet_id)
    .is('deleted_at', null)
    .single();

  if (error || !expense) {
    throw new AppError(404, 'EXPENSE_NOT_FOUND', 'Expense not found');
  }

  if (expense.created_by_user_id !== context.account.user_id) {
    throw new AppError(
      403,
      'TELEGRAM_ATTACHMENT_DENIED',
      'Only the Telegram expense creator can attach an image'
    );
  }

  return createExpenseAttachment(
    context.connection.wallet_id,
    expenseId,
    context.account.user_id,
    file
  );
}

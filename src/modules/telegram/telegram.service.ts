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

type CreateTelegramExpenseRequest = TelegramContextRequest & {
  title?: string;
  total_amount?: number;
  expense_date?: string;
};

type TelegramAccountRow = {
  user_id: string;
  telegram_user_id: number | string;
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

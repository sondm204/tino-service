import { AppError } from '../../common/app-error.js';
import { isEnumValue, UserStatus } from '../../common/enums.js';
import type { PageableRequest } from '../../common/pageable.js';
import { toPageableResponse, toSupabaseRange } from '../../common/pageable.js';
import { deleteObject } from '../../common/object-storage.js';
import { hashPassword, verifyPassword } from '../../common/password.js';
import { supabase } from '../../db/supabase.js';
import { Jimp } from 'jimp';
import QrCode from 'qrcode-reader';

export type CreateUserRequest = {
  email?: string;
  password?: string;
  display_name?: string;
  avatar_url?: string | null;
  status?: string;
};

export type UserResponse = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: UserStatus;
  created_at: string;
  updated_at: string | null;
};

export type UpdateProfileRequest = {
  display_name?: string;
};

export type ChangePasswordRequest = {
  current_password?: string;
  new_password?: string;
};

export type BankAccountResponse = {
  id: string;
  user_id: string;
  bank_name: string;
  bank_bin: string;
  account_number: string;
  account_name: string;
  qr_image_url: string | null;
  qr_image_path: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string | null;
};

export type UpsertBankAccountRequest = {
  bank_name?: string;
  bank_bin?: string;
  account_number?: string;
  account_name?: string;
  is_default?: boolean;
};

export type DecodedBankQrResponse = {
  bank_bin: string;
  account_number: string;
  account_name: string | null;
  raw_payload: string;
};

const USER_SELECT =
  'id, email, display_name, avatar_url, status, created_at, updated_at';

export async function listUsers(pageable: PageableRequest) {
  const { from, to } = toSupabaseRange(pageable);
  const { data, error, count } = await supabase
    .from('users')
    .select('id, email, display_name, avatar_url, status, created_at, updated_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new AppError(400, 'USER_LIST_FAILED', error.message);
  }

  return toPageableResponse((data ?? []) as UserResponse[], pageable, count ?? 0);
}

export async function findUserByEmail(emailInput: string | undefined) {
  const email = emailInput?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email is invalid');
  }

  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .eq('email', email)
    .eq('status', UserStatus.Active)
    .single();

  if (error || !data) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  return data as UserResponse;
}

export async function createUser(payload: CreateUserRequest) {
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password;
  const displayName = payload.display_name?.trim();
  const avatarUrl = payload.avatar_url?.trim() || null;
  const status = payload.status?.trim() || UserStatus.Active;

  if (!email) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email is required');
  }

  if (!email.includes('@')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email is invalid');
  }

  if (!password || password.length < 8) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Password must be at least 8 characters'
    );
  }

  if (!displayName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'display_name is required');
  }

  if (!isEnumValue(UserStatus, status)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'status is invalid');
  }

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('users')
    .insert({
      email,
      password: passwordHash,
      display_name: displayName,
      avatar_url: avatarUrl,
      status,
    })
    .select('id, email, display_name, avatar_url, status, created_at, updated_at')
    .single();

  if (error) {
    throw new AppError(400, 'USER_CREATE_FAILED', error.message);
  }

  return data as UserResponse;
}

export async function updateProfile(
  userId: string,
  payload: UpdateProfileRequest
) {
  const updates: Record<string, string> = {};

  if (payload.display_name !== undefined) {
    const displayName = payload.display_name.trim();

    if (!displayName) {
      throw new AppError(400, 'VALIDATION_ERROR', 'display_name is required');
    }

    updates.display_name = displayName;
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'No profile fields to update');
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select(USER_SELECT)
    .single();

  if (error || !data) {
    const duplicateEmail = error?.code === '23505';
    throw new AppError(
      duplicateEmail ? 409 : 400,
      duplicateEmail ? 'EMAIL_ALREADY_EXISTS' : 'USER_UPDATE_FAILED',
      duplicateEmail ? 'Email is already in use' : error?.message || 'Could not update user'
    );
  }

  return data as UserResponse;
}

export async function updateAvatar(userId: string, avatarUrl: string) {
  const { data, error } = await supabase
    .from('users')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId)
    .select(USER_SELECT)
    .single();

  if (error || !data) {
    throw new AppError(400, 'AVATAR_UPDATE_FAILED', error?.message || 'Could not update avatar');
  }

  return data as UserResponse;
}

export async function changePassword(
  userId: string,
  payload: ChangePasswordRequest
) {
  const currentPassword = payload.current_password;
  const newPassword = payload.new_password;

  if (!currentPassword || !newPassword) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'current_password and new_password are required'
    );
  }

  if (newPassword.length < 8) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'New password must be at least 8 characters'
    );
  }

  const { data, error } = await supabase
    .from('users')
    .select('password')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const isValid = await verifyPassword(currentPassword, data.password as string);

  if (!isValid) {
    throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ password: await hashPassword(newPassword) })
    .eq('id', userId);

  if (updateError) {
    throw new AppError(400, 'PASSWORD_UPDATE_FAILED', updateError.message);
  }

  return { updated: true };
}

function normalizeBankAccountPayload(payload: UpsertBankAccountRequest) {
  const bankName = payload.bank_name?.trim();
  const bankBin = payload.bank_bin?.trim();
  const accountNumber = payload.account_number?.trim();
  const accountName = payload.account_name?.trim().toUpperCase();

  if (!bankName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'bank_name is required');
  }

  if (!bankBin || !/^\d{3,8}$/.test(bankBin)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'bank_bin must be 3-8 digits');
  }

  if (!accountNumber || !/^\d{4,32}$/.test(accountNumber)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'account_number must be 4-32 digits');
  }

  if (!accountName) {
    throw new AppError(400, 'VALIDATION_ERROR', 'account_name is required');
  }

  return {
    bank_name: bankName,
    bank_bin: bankBin,
    account_number: accountNumber,
    account_name: accountName,
    is_default: payload.is_default ?? true,
  };
}

async function clearDefaultBankAccount(userId: string) {
  await supabase
    .from('user_bank_accounts')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true);
}

function parseTlv(input: string) {
  const tags = new Map<string, string[]>();
  let index = 0;

  while (index + 4 <= input.length) {
    const id = input.slice(index, index + 2);
    const lengthText = input.slice(index + 2, index + 4);
    const length = Number(lengthText);

    if (!/^\d{2}$/.test(id) || !Number.isInteger(length) || length < 0) {
      break;
    }

    const valueStart = index + 4;
    const valueEnd = valueStart + length;

    if (valueEnd > input.length) {
      break;
    }

    const current = tags.get(id) ?? [];
    current.push(input.slice(valueStart, valueEnd));
    tags.set(id, current);
    index = valueEnd;
  }

  return tags;
}

function getFirstTlvValue(tags: Map<string, string[]>, id: string) {
  return tags.get(id)?.[0]?.trim() || null;
}

function parseVietQrPayload(payload: string): DecodedBankQrResponse {
  const rootTags = parseTlv(payload);
  const merchantAccountInfo = Array.from(rootTags.values())
    .flat()
    .find((value) => value.includes('A000000727'));

  if (!merchantAccountInfo) {
    throw new AppError(400, 'QR_NOT_VIETQR', 'QR image is not a supported VietQR code');
  }

  const merchantTags = parseTlv(merchantAccountInfo);
  const consumerInfo = getFirstTlvValue(merchantTags, '01');

  if (!consumerInfo) {
    throw new AppError(400, 'QR_ACCOUNT_INFO_MISSING', 'QR code does not contain bank account info');
  }

  const consumerTags = parseTlv(consumerInfo);
  const bankBin = getFirstTlvValue(consumerTags, '00');
  const accountNumber = getFirstTlvValue(consumerTags, '01');
  const accountName = getFirstTlvValue(rootTags, '59');

  if (!bankBin || !accountNumber) {
    throw new AppError(400, 'QR_ACCOUNT_INFO_MISSING', 'QR code does not contain bank BIN and account number');
  }

  return {
    bank_bin: bankBin,
    account_number: accountNumber,
    account_name: accountName,
    raw_payload: payload,
  };
}

function decodeQrBitmap(image: { bitmap: unknown }) {
  return new Promise<string>((resolve, reject) => {
    const qr = new QrCode();
    qr.callback = (error, value) => {
      if (error) {
        reject(error);
        return;
      }

      const result = value?.result?.trim();

      if (!result) {
        reject(new Error('QR code result is empty'));
        return;
      }

      resolve(result);
    };
    qr.decode(image.bitmap);
  });
}

export async function listBankAccounts(userId: string) {
  const { data, error } = await supabase
    .from('user_bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new AppError(400, 'BANK_ACCOUNT_LIST_FAILED', error.message);
  }

  return (data ?? []) as BankAccountResponse[];
}

export async function createBankAccount(
  userId: string,
  payload: UpsertBankAccountRequest
) {
  const values = normalizeBankAccountPayload(payload);

  if (values.is_default) {
    await clearDefaultBankAccount(userId);
  }

  const { data, error } = await supabase
    .from('user_bank_accounts')
    .insert({
      ...values,
      user_id: userId,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError(
      400,
      'BANK_ACCOUNT_CREATE_FAILED',
      error?.message || 'Could not create bank account'
    );
  }

  return data as BankAccountResponse;
}

export async function updateBankAccountQrImage(
  userId: string,
  bankAccountId: string,
  uploaded: { key: string; url: string }
) {
  const { data, error } = await supabase
    .from('user_bank_accounts')
    .update({
      qr_image_url: uploaded.url,
      qr_image_path: uploaded.key,
    })
    .eq('id', bankAccountId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError(
      404,
      'BANK_ACCOUNT_NOT_FOUND',
      error?.message || 'Bank account not found'
    );
  }

  return data as BankAccountResponse;
}

export async function deleteBankAccount(userId: string, bankAccountId: string) {
  const { data: existing, error: lookupError } = await supabase
    .from('user_bank_accounts')
    .select('id, qr_image_path')
    .eq('id', bankAccountId)
    .eq('user_id', userId)
    .single();

  if (lookupError || !existing) {
    throw new AppError(
      404,
      'BANK_ACCOUNT_NOT_FOUND',
      lookupError?.message || 'Bank account not found'
    );
  }

  const { error } = await supabase
    .from('user_bank_accounts')
    .delete()
    .eq('id', bankAccountId)
    .eq('user_id', userId);

  if (error) {
    throw new AppError(400, 'BANK_ACCOUNT_DELETE_FAILED', error.message);
  }

  const qrImagePath = typeof existing.qr_image_path === 'string'
    ? existing.qr_image_path
    : null;

  if (qrImagePath) {
    try {
      await deleteObject(qrImagePath);
    } catch (error) {
      console.error('Bank QR cleanup failed after account delete', {
        bankAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { id: bankAccountId };
}

export async function decodeBankAccountQrImage(file: Express.Multer.File) {
  try {
    const image = await Jimp.read(file.buffer);
    const payload = await decodeQrBitmap(image);

    return parseVietQrPayload(payload);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      400,
      'QR_DECODE_FAILED',
      error instanceof Error ? error.message : 'Could not decode QR image'
    );
  }
}

export async function getDefaultBankAccountForUser(userId: string) {
  const { data, error } = await supabase
    .from('user_bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle();

  if (error) {
    throw new AppError(400, 'BANK_ACCOUNT_LOOKUP_FAILED', error.message);
  }

  if (!data) {
    throw new AppError(
      404,
      'BANK_ACCOUNT_NOT_FOUND',
      'Receiver has no default bank account'
    );
  }

  return data as BankAccountResponse;
}

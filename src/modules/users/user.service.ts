import { AppError } from '../../common/app-error.js';
import { isEnumValue, UserStatus } from '../../common/enums.js';
import type { PageableRequest } from '../../common/pageable.js';
import { toPageableResponse, toSupabaseRange } from '../../common/pageable.js';
import { hashPassword, verifyPassword } from '../../common/password.js';
import { supabase } from '../../db/supabase.js';

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

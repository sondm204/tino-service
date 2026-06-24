import { AppError } from '../../common/app-error.js';
import { isEnumValue, UserStatus } from '../../common/enums.js';
import type { PageableRequest } from '../../common/pageable.js';
import { toPageableResponse, toSupabaseRange } from '../../common/pageable.js';
import { hashPassword } from '../../common/password.js';
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

import { AppError } from '../../common/app-error.js';
import { createAuthToken, getBearerToken, verifyAuthToken } from '../../common/auth-token.js';
import { verifyPassword } from '../../common/password.js';
import { supabase } from '../../db/supabase.js';
import { createUser, type CreateUserRequest, type UserResponse } from '../users/user.service.js';

export type LoginRequest = {
  email?: string;
  password?: string;
};

type UserWithPassword = UserResponse & {
  password: string;
};

export async function register(payload: CreateUserRequest) {
  const user = await createUser(payload);
  const token = createAuthToken(user.id);

  return { user, token };
}

export async function login(payload: LoginRequest) {
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password;

  if (!email || !password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email and password are required');
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, email, password, display_name, avatar_url, status, created_at, updated_at')
    .eq('email', email)
    .single();

  if (error || !data) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const user = data as UserWithPassword;
  const isPasswordValid = await verifyPassword(password, user.password);

  if (!isPasswordValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const { password: _password, ...safeUser } = user;
  const token = createAuthToken(user.id);

  return { user: safeUser, token };
}

export async function getCurrentUser(authorizationHeader?: string) {
  const token = getBearerToken(authorizationHeader);

  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing bearer token');
  }

  const payload = verifyAuthToken(token);

  if (!payload) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, email, display_name, avatar_url, status, created_at, updated_at')
    .eq('id', payload.user_id)
    .single();

  if (error || !data) {
    throw new AppError(401, 'UNAUTHORIZED', 'User not found');
  }

  return data as UserResponse;
}

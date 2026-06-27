import { AppError } from '../../common/app-error.js';
import {
  createAccessToken,
  createRefreshToken,
  getAccessTokenTtlSeconds,
  getRefreshTokenExpiresAt,
  hashRefreshToken,
} from '../../common/auth-token.js';
import { UserStatus } from '../../common/enums.js';
import { verifyPassword } from '../../common/password.js';
import { supabase } from '../../db/supabase.js';
import { createUser, type CreateUserRequest, type UserResponse } from '../users/user.service.js';

export type LoginRequest = {
  email?: string;
  password?: string;
};

export type RefreshTokenRequest = {
  refresh_token?: string;
};

type UserWithPassword = UserResponse & {
  password: string;
};

type RefreshTokenRow = {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
};

const CURRENT_USER_CACHE_TTL_MS = 60_000;
const currentUserCache = new Map<
  string,
  { expiresAt: number; user: UserResponse }
>();

function cacheCurrentUser(user: UserResponse) {
  currentUserCache.set(user.id, {
    expiresAt: Date.now() + CURRENT_USER_CACHE_TTL_MS,
    user,
  });
}

async function issueTokenPair(userId: string) {
  const accessToken = createAccessToken(userId);
  const refreshToken = createRefreshToken();
  const { data, error } = await supabase
    .from('auth_refresh_tokens')
    .insert({
      user_id: userId,
      token_hash: hashRefreshToken(refreshToken),
      expires_at: getRefreshTokenExpiresAt(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new AppError(500, 'TOKEN_ISSUE_FAILED', 'Could not issue refresh token');
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    access_token_expires_in: getAccessTokenTtlSeconds(),
    refresh_token_id: data.id as string,
  };
}

export async function register(payload: CreateUserRequest) {
  const user = await createUser(payload);
  const tokens = await issueTokenPair(user.id);
  const {
    refresh_token_id: _refreshTokenId,
    ...publicTokens
  } = tokens;

  cacheCurrentUser(user);
  return { user, ...publicTokens };
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

  if (user.status !== UserStatus.Active) {
    throw new AppError(403, 'USER_INACTIVE', 'User account is inactive');
  }

  const { password: _password, ...safeUser } = user;
  const tokens = await issueTokenPair(user.id);
  const {
    refresh_token_id: _refreshTokenId,
    ...publicTokens
  } = tokens;

  cacheCurrentUser(safeUser);
  return { user: safeUser, ...publicTokens };
}

export async function getCurrentUser(userId: string) {
  const cached = currentUserCache.get(userId);

  if (cached && cached.expiresAt > Date.now()) {
    if (cached.user.status !== UserStatus.Active) {
      throw new AppError(403, 'USER_INACTIVE', 'User account is inactive');
    }

    return cached.user;
  }

  if (cached) {
    currentUserCache.delete(userId);
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, email, display_name, avatar_url, status, created_at, updated_at')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new AppError(401, 'UNAUTHORIZED', 'User not found');
  }

  const user = data as UserResponse;

  if (user.status !== UserStatus.Active) {
    throw new AppError(403, 'USER_INACTIVE', 'User account is inactive');
  }

  cacheCurrentUser(user);
  return user;
}

export async function refreshSession(payload: RefreshTokenRequest) {
  const refreshToken = payload.refresh_token?.trim();

  if (!refreshToken) {
    throw new AppError(400, 'VALIDATION_ERROR', 'refresh_token is required');
  }

  const { data, error } = await supabase
    .from('auth_refresh_tokens')
    .select('id, user_id, expires_at, revoked_at')
    .eq('token_hash', hashRefreshToken(refreshToken))
    .single();

  if (error || !data) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  const tokenRow = data as RefreshTokenRow;

  if (
    tokenRow.revoked_at ||
    new Date(tokenRow.expires_at).getTime() <= Date.now()
  ) {
    throw new AppError(
      401,
      'INVALID_REFRESH_TOKEN',
      'Refresh token is expired or revoked'
    );
  }

  const user = await getCurrentUser(tokenRow.user_id);
  const tokens = await issueTokenPair(tokenRow.user_id);
  const revokedAt = new Date().toISOString();
  const { data: revokedToken, error: revokeError } = await supabase
    .from('auth_refresh_tokens')
    .update({
      revoked_at: revokedAt,
      replaced_by_token_id: tokens.refresh_token_id,
    })
    .eq('id', tokenRow.id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (revokeError || !revokedToken) {
    await supabase
      .from('auth_refresh_tokens')
      .delete()
      .eq('id', tokens.refresh_token_id);
    throw new AppError(
      401,
      'REFRESH_TOKEN_REUSED',
      'Refresh token has already been used'
    );
  }

  return {
    user,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_in: tokens.access_token_expires_in,
  };
}

export async function logout(payload: RefreshTokenRequest) {
  const refreshToken = payload.refresh_token?.trim();

  if (!refreshToken) {
    return { revoked: false };
  }

  const { data, error } = await supabase
    .from('auth_refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', hashRefreshToken(refreshToken))
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    throw new AppError(500, 'LOGOUT_FAILED', 'Could not revoke refresh token');
  }

  return { revoked: Boolean(data) };
}

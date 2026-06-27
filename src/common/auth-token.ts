import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export type AccessTokenPayload = {
  type: 'access';
  user_id: string;
  exp: number;
};

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function getPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAccessTokenTtlSeconds() {
  return getPositiveInteger(
    process.env.ACCESS_TOKEN_TTL_SECONDS,
    DEFAULT_ACCESS_TOKEN_TTL_SECONDS
  );
}

export function getRefreshTokenTtlSeconds() {
  return getPositiveInteger(
    process.env.REFRESH_TOKEN_TTL_SECONDS,
    DEFAULT_REFRESH_TOKEN_TTL_SECONDS
  );
}

function getTokenSecret() {
  const secret = process.env.AUTH_TOKEN_SECRET;

  if (!secret || secret === 'dev-secret' || secret === 'change-me') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_TOKEN_SECRET must be configured in production');
    }

    return process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret';
  }

  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url');
}

function sign(value: string) {
  return createHmac('sha256', getTokenSecret()).update(value).digest('base64url');
}

export function createAccessToken(
  userId: string,
  ttlSeconds = getAccessTokenTtlSeconds()
) {
  const payload: AccessTokenPayload = {
    type: 'access',
    user_id: userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = base64UrlEncode(JSON.stringify(payload));

  return `${body}.${sign(body)}`;
}

export function verifyAccessToken(token: string) {
  const [body, signature] = token.split('.');

  if (!body || !signature) {
    return null;
  }

  const expectedSignature = sign(body);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString()
    ) as AccessTokenPayload;

    if (
      payload.type !== 'access' ||
      !payload.user_id ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function createRefreshToken() {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function getRefreshTokenExpiresAt() {
  return new Date(
    Date.now() + getRefreshTokenTtlSeconds() * 1000
  ).toISOString();
}

export function getBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }

  return authorizationHeader.slice('Bearer '.length).trim();
}

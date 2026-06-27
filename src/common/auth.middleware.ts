import type { NextFunction, Request, Response } from 'express';
import { sendError } from './api-response.js';
import { getBearerToken, verifyAccessToken } from './auth-token.js';
import { AppError } from './app-error.js';

export type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
  };
};

export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token = getBearerToken(req.headers.authorization);
  const payload = token ? verifyAccessToken(token) : null;

  if (!payload) {
    return sendError(
      res,
      401,
      'UNAUTHORIZED',
      token ? 'Invalid or expired access token' : 'Missing access token'
    );
  }

  req.auth = { userId: payload.user_id };
  next();
}

export function getAuthenticatedUserId(req: Request) {
  const userId = (req as AuthenticatedRequest).auth?.userId;

  if (!userId) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
  }

  return userId;
}

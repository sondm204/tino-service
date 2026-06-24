import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getCurrentUser, login, register } from './auth.service.js';

function handleError(res: Response, error: unknown) {
  if (isAppError(error)) {
    return sendError(res, error.status, error.code, error.message);
  }

  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
}

export async function postRegister(req: Request, res: Response) {
  try {
    const data = await register(req.body);

    return sendSuccess(res, 201, 'AUTH_REGISTERED', 'Registered successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postLogin(req: Request, res: Response) {
  try {
    const data = await login(req.body);

    return sendSuccess(res, 200, 'AUTH_LOGGED_IN', 'Logged in successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postLogout(_req: Request, res: Response) {
  return sendSuccess(res, 200, 'AUTH_LOGGED_OUT', 'Logged out successfully', {
    revoked: false,
  });
}

export async function getMe(req: Request, res: Response) {
  try {
    const data = await getCurrentUser(req.headers.authorization);

    return sendSuccess(res, 200, 'AUTH_ME', 'Current user fetched successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

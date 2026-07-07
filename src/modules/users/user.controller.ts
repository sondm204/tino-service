import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getPageable } from '../../common/pageable.js';
import { getAuthenticatedUserId } from '../../common/auth.middleware.js';
import { uploadUserAvatar } from '../../common/object-storage.js';
import {
  changePassword,
  createUser,
  findUserByEmail,
  listUsers,
  updateAvatar,
  updateProfile,
} from './user.service.js';

function handleError(res: Response, error: unknown) {
  if (isAppError(error)) {
    return sendError(res, error.status, error.code, error.message);
  }

  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
}

export async function getUsers(req: Request, res: Response) {
  try {
    const data = await listUsers(getPageable(req));

    return sendSuccess(res, 200, 'USER_LISTED', 'Users fetched successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function getUserLookup(req: Request, res: Response) {
  try {
    const email =
      typeof req.query.email === 'string' ? req.query.email : undefined;
    const data = await findUserByEmail(email);

    return sendSuccess(res, 200, 'USER_FOUND', 'User fetched successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postUser(req: Request, res: Response) {
  try {
    const data = await createUser(req.body);

    return sendSuccess(res, 201, 'USER_CREATED', 'User created successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function patchProfile(req: Request, res: Response) {
  try {
    const data = await updateProfile(getAuthenticatedUserId(req), req.body);

    return sendSuccess(res, 200, 'PROFILE_UPDATED', 'Profile updated successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function patchPassword(req: Request, res: Response) {
  try {
    const data = await changePassword(getAuthenticatedUserId(req), req.body);

    return sendSuccess(res, 200, 'PASSWORD_UPDATED', 'Password updated successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postAvatar(req: Request, res: Response) {
  try {
    if (!req.file) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'avatar file is required');
    }

    const userId = getAuthenticatedUserId(req);
    const uploaded = await uploadUserAvatar(userId, req.file);
    const user = await updateAvatar(userId, uploaded.url);

    return sendSuccess(res, 200, 'AVATAR_UPDATED', 'Avatar updated successfully', {
      user,
      object_key: uploaded.key,
    });
  } catch (error) {
    return handleError(res, error);
  }
}

import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getPageable } from '../../common/pageable.js';
import { createUser, listUsers } from './user.service.js';

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

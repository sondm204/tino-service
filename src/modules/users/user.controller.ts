import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getPageable } from '../../common/pageable.js';
import { getAuthenticatedUserId } from '../../common/auth.middleware.js';
import {
  uploadBankAccountQrImage,
  uploadUserAvatar,
} from '../../common/object-storage.js';
import {
  changePassword,
  createBankAccount,
  createUser,
  decodeBankAccountQrImage,
  deleteBankAccount,
  findUserByEmail,
  listBankAccounts,
  listUsers,
  updateBankAccountQrImage,
  updateAvatar,
  updateProfile,
} from './user.service.js';
import { getRequiredParam } from '../../common/request.js';

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

export async function getBankAccounts(req: Request, res: Response) {
  try {
    const data = await listBankAccounts(getAuthenticatedUserId(req));

    return sendSuccess(
      res,
      200,
      'BANK_ACCOUNTS_LISTED',
      'Bank accounts fetched successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postBankAccount(req: Request, res: Response) {
  try {
    const data = await createBankAccount(getAuthenticatedUserId(req), req.body);

    return sendSuccess(
      res,
      201,
      'BANK_ACCOUNT_CREATED',
      'Bank account created successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function deleteBankAccountById(req: Request, res: Response) {
  try {
    const data = await deleteBankAccount(
      getAuthenticatedUserId(req),
      getRequiredParam(req.params, 'bankAccountId')
    );

    return sendSuccess(
      res,
      200,
      'BANK_ACCOUNT_DELETED',
      'Bank account deleted successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postBankAccountQrDecode(req: Request, res: Response) {
  try {
    if (!req.file) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'qr image is required');
    }

    const data = await decodeBankAccountQrImage(req.file);

    return sendSuccess(
      res,
      200,
      'BANK_ACCOUNT_QR_DECODED',
      'Bank account QR decoded successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postBankAccountQrImage(req: Request, res: Response) {
  try {
    if (!req.file) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'qr image is required');
    }

    const userId = getAuthenticatedUserId(req);
    const bankAccountId = getRequiredParam(req.params, 'bankAccountId');
    const uploaded = await uploadBankAccountQrImage(userId, bankAccountId, req.file);
    const data = await updateBankAccountQrImage(userId, bankAccountId, uploaded);

    return sendSuccess(
      res,
      200,
      'BANK_ACCOUNT_QR_UPDATED',
      'Bank account QR image updated successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

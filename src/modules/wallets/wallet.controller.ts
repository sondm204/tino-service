import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getAuthenticatedUserId } from '../../common/auth.middleware.js';
import { getPageable } from '../../common/pageable.js';
import { getRequiredParam } from '../../common/request.js';
import {
  addWalletMember,
  createWallet,
  deleteWallet,
  getWallet,
  getWalletSummary,
  inviteWalletMemberByEmail,
  listWalletMembers,
  listWallets,
  requireWalletMember,
} from './wallet.service.js';

export async function getWallets(req: Request, res: Response) {
  try {
    const userId = getAuthenticatedUserId(req);
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const data = await listWallets(getPageable(req), userId, month);

    return sendSuccess(res, 200, 'WALLET_LISTED', 'Wallets fetched successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function postWallet(req: Request, res: Response) {
  try {
    const data = await createWallet(req.body, getAuthenticatedUserId(req));

    return sendSuccess(res, 201, 'WALLET_CREATED', 'Wallet created successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function deleteWalletById(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const data = await deleteWallet(walletId, getAuthenticatedUserId(req));

    return sendSuccess(res, 200, 'WALLET_DELETED', 'Wallet deleted successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function getWalletById(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    await requireWalletMember(walletId, getAuthenticatedUserId(req));
    const data = await getWallet(walletId);

    return sendSuccess(res, 200, 'WALLET_FETCHED', 'Wallet fetched successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function postWalletMember(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const data = await addWalletMember(
      walletId,
      req.body,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(
      res,
      201,
      'WALLET_MEMBER_CREATED',
      'Wallet member created successfully',
      data
    );
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function postWalletInvitation(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const data = await inviteWalletMemberByEmail(
      walletId,
      req.body,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(
      res,
      201,
      'WALLET_MEMBER_INVITED',
      'Wallet member invited successfully',
      data
    );
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function getWalletMembers(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const data = await listWalletMembers(
      walletId,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(
      res,
      200,
      'WALLET_MEMBER_LISTED',
      'Wallet members fetched successfully',
      data
    );
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function getSummary(req: Request, res: Response) {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const walletId = getRequiredParam(req.params, 'walletId');
    const data = await getWalletSummary(
      walletId,
      month,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(
      res,
      200,
      'WALLET_SUMMARY_FETCHED',
      'Wallet summary fetched successfully',
      data
    );
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

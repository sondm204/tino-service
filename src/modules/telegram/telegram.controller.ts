import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getAuthenticatedUserId } from '../../common/auth.middleware.js';
import { getRequiredParam } from '../../common/request.js';
import {
  connectTelegramChat,
  createTelegramExpense,
  createTelegramExpenseAttachment,
  createTelegramLinkCode,
  createTelegramWalletConnectCode,
  getTelegramContext,
  getTelegramSummary,
  linkTelegramAccount,
} from './telegram.service.js';

function handleError(res: Response, error: unknown) {
  if (isAppError(error)) {
    return sendError(res, error.status, error.code, error.message);
  }

  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
}

export async function postTelegramLinkCode(req: Request, res: Response) {
  try {
    const data = await createTelegramLinkCode(getAuthenticatedUserId(req));
    return sendSuccess(
      res,
      201,
      'TELEGRAM_LINK_CODE_CREATED',
      'Telegram link code created',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postTelegramWalletConnectCode(
  req: Request,
  res: Response
) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const data = await createTelegramWalletConnectCode(
      walletId,
      getAuthenticatedUserId(req)
    );
    return sendSuccess(
      res,
      201,
      'TELEGRAM_WALLET_CODE_CREATED',
      'Telegram wallet connect code created',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postTelegramLink(req: Request, res: Response) {
  try {
    const data = await linkTelegramAccount(req.body);
    return sendSuccess(
      res,
      200,
      'TELEGRAM_ACCOUNT_LINKED',
      'Telegram account linked',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postTelegramConnect(req: Request, res: Response) {
  try {
    const data = await connectTelegramChat(req.body);
    return sendSuccess(
      res,
      200,
      'TELEGRAM_CHAT_CONNECTED',
      'Telegram chat connected',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postTelegramContext(req: Request, res: Response) {
  try {
    const data = await getTelegramContext(req.body);
    return sendSuccess(
      res,
      200,
      'TELEGRAM_CONTEXT_FETCHED',
      'Telegram context fetched',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postTelegramSummary(req: Request, res: Response) {
  try {
    const data = await getTelegramSummary(req.body);
    return sendSuccess(
      res,
      200,
      'TELEGRAM_SUMMARY_FETCHED',
      'Telegram wallet summary fetched',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postTelegramExpense(req: Request, res: Response) {
  try {
    const data = await createTelegramExpense(req.body);
    return sendSuccess(
      res,
      201,
      'TELEGRAM_EXPENSE_CREATED',
      'Telegram expense created',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postTelegramExpenseAttachment(
  req: Request,
  res: Response
) {
  try {
    if (!req.file) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'attachment file is required'
      );
    }

    const expenseId = getRequiredParam(req.params, 'expenseId');
    const data = await createTelegramExpenseAttachment(
      expenseId,
      req.body,
      req.file
    );
    return sendSuccess(
      res,
      201,
      'TELEGRAM_ATTACHMENT_CREATED',
      'Telegram expense attachment uploaded',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getAuthenticatedUserId } from '../../common/auth.middleware.js';
import { getPageable } from '../../common/pageable.js';
import { getRequiredParam } from '../../common/request.js';
import {
  createExpenseAttachment,
  createExpense,
  deleteExpenseAttachment,
  deleteExpense,
  listExpenses,
  updateExpense,
} from './expense.service.js';

function handleError(res: Response, error: unknown) {
  if (isAppError(error)) {
    return sendError(res, error.status, error.code, error.message);
  }

  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
}

export async function getExpenses(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const data = await listExpenses(
      walletId,
      getPageable(req),
      getAuthenticatedUserId(req),
      month
    );

    return sendSuccess(res, 200, 'EXPENSE_LISTED', 'Expenses fetched successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postExpense(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const data = await createExpense(
      walletId,
      req.body,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(res, 201, 'EXPENSE_CREATED', 'Expense created successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function patchExpense(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const expenseId = getRequiredParam(req.params, 'expenseId');
    const data = await updateExpense(
      walletId,
      expenseId,
      req.body,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(res, 200, 'EXPENSE_UPDATED', 'Expense updated successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function removeExpense(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const expenseId = getRequiredParam(req.params, 'expenseId');
    const data = await deleteExpense(
      walletId,
      expenseId,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(res, 200, 'EXPENSE_DELETED', 'Expense deleted successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postExpenseAttachment(req: Request, res: Response) {
  try {
    if (!req.file) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'attachment file is required');
    }

    const walletId = getRequiredParam(req.params, 'walletId');
    const expenseId = getRequiredParam(req.params, 'expenseId');
    const data = await createExpenseAttachment(
      walletId,
      expenseId,
      getAuthenticatedUserId(req),
      req.file
    );

    return sendSuccess(
      res,
      201,
      'ATTACHMENT_CREATED',
      'Attachment uploaded successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function removeExpenseAttachment(req: Request, res: Response) {
  try {
    const walletId = getRequiredParam(req.params, 'walletId');
    const expenseId = getRequiredParam(req.params, 'expenseId');
    const attachmentId = getRequiredParam(req.params, 'attachmentId');
    const data = await deleteExpenseAttachment(
      walletId,
      expenseId,
      attachmentId,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(
      res,
      200,
      'ATTACHMENT_DELETED',
      'Attachment deleted successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

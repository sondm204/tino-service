import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getPageable } from '../../common/pageable.js';
import { getRequiredParam } from '../../common/request.js';
import {
  createExpense,
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
    const groupId = getRequiredParam(req.params, 'groupId');
    const data = await listExpenses(groupId, getPageable(req));

    return sendSuccess(res, 200, 'EXPENSE_LISTED', 'Expenses fetched successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function postExpense(req: Request, res: Response) {
  try {
    const groupId = getRequiredParam(req.params, 'groupId');
    const data = await createExpense(groupId, req.body);

    return sendSuccess(res, 201, 'EXPENSE_CREATED', 'Expense created successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function patchExpense(req: Request, res: Response) {
  try {
    const groupId = getRequiredParam(req.params, 'groupId');
    const expenseId = getRequiredParam(req.params, 'expenseId');
    const data = await updateExpense(groupId, expenseId, req.body);

    return sendSuccess(res, 200, 'EXPENSE_UPDATED', 'Expense updated successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

export async function removeExpense(req: Request, res: Response) {
  try {
    const groupId = getRequiredParam(req.params, 'groupId');
    const expenseId = getRequiredParam(req.params, 'expenseId');
    const data = await deleteExpense(groupId, expenseId);

    return sendSuccess(res, 200, 'EXPENSE_DELETED', 'Expense deleted successfully', data);
  } catch (error) {
    return handleError(res, error);
  }
}

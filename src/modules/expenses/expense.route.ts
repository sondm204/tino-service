import { Router } from 'express';
import {
  getExpenses,
  patchExpense,
  postExpense,
  removeExpense,
} from './expense.controller.js';

export const expenseRouter = Router({ mergeParams: true });

expenseRouter.get('/', getExpenses);
expenseRouter.post('/', postExpense);
expenseRouter.patch('/:expenseId', patchExpense);
expenseRouter.delete('/:expenseId', removeExpense);

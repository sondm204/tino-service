import { Router } from 'express';
import {
  getWalletById,
  getWalletMembers,
  getWallets,
  getSummary,
  postWallet,
  postWalletMember,
} from './wallet.controller.js';
import { expenseRouter } from '../expenses/expense.route.js';

export const walletRouter = Router();

walletRouter.get('/', getWallets);
walletRouter.post('/', postWallet);
walletRouter.use('/:walletId/expenses', expenseRouter);
walletRouter.get('/:walletId/members', getWalletMembers);
walletRouter.get('/:walletId', getWalletById);
walletRouter.post('/:walletId/members', postWalletMember);
walletRouter.get('/:walletId/summary', getSummary);

import { Router } from 'express';
import {
  deleteWalletById,
  getWalletById,
  getWalletMembers,
  getWallets,
  getSummary,
  postWallet,
  postWalletInvitation,
  postWalletLeave,
  postWalletMember,
  postPaymentQr,
} from './wallet.controller.js';
import { expenseRouter } from '../expenses/expense.route.js';

export const walletRouter = Router();

walletRouter.get('/', getWallets);
walletRouter.post('/', postWallet);
walletRouter.use('/:walletId/expenses', expenseRouter);
walletRouter.delete('/:walletId', deleteWalletById);
walletRouter.post('/:walletId/invitations', postWalletInvitation);
walletRouter.post('/:walletId/leave', postWalletLeave);
walletRouter.post('/:walletId/payment-qr', postPaymentQr);
walletRouter.get('/:walletId/members', getWalletMembers);
walletRouter.get('/:walletId', getWalletById);
walletRouter.post('/:walletId/members', postWalletMember);
walletRouter.get('/:walletId/summary', getSummary);

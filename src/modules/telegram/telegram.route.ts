import { Router } from 'express';
import {
  postTelegramConnect,
  postTelegramContext,
  postTelegramExpense,
  postTelegramLink,
  postTelegramLinkCode,
  postTelegramWalletConnectCode,
} from './telegram.controller.js';

export const telegramUserRouter = Router();
export const telegramBotRouter = Router();

telegramUserRouter.post('/link-code', postTelegramLinkCode);
telegramUserRouter.post(
  '/wallets/:walletId/connect-code',
  postTelegramWalletConnectCode
);

telegramBotRouter.post('/link', postTelegramLink);
telegramBotRouter.post('/connect', postTelegramConnect);
telegramBotRouter.post('/context', postTelegramContext);
telegramBotRouter.post('/expenses', postTelegramExpense);

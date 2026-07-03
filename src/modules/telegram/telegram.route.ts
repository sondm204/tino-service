import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../common/app-error.js';
import {
  postTelegramConnect,
  postTelegramContext,
  postTelegramExpense,
  postTelegramExpenseAttachment,
  postTelegramLink,
  postTelegramLinkCode,
  postTelegramWalletConnectCode,
} from './telegram.controller.js';

export const telegramUserRouter = Router();
export const telegramBotRouter = Router();
const telegramAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(
        new AppError(
          400,
          'INVALID_ATTACHMENT_TYPE',
          'Attachment must be JPEG, PNG, or WebP'
        )
      );
      return;
    }

    callback(null, true);
  },
});

telegramUserRouter.post('/link-code', postTelegramLinkCode);
telegramUserRouter.post(
  '/wallets/:walletId/connect-code',
  postTelegramWalletConnectCode
);

telegramBotRouter.post('/link', postTelegramLink);
telegramBotRouter.post('/connect', postTelegramConnect);
telegramBotRouter.post('/context', postTelegramContext);
telegramBotRouter.post('/expenses', postTelegramExpense);
telegramBotRouter.post(
  '/expenses/:expenseId/attachments',
  telegramAttachmentUpload.single('attachment'),
  postTelegramExpenseAttachment
);

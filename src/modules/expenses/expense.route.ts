import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../common/app-error.js';
import {
  getExpenses,
  getRecentExpenses,
  patchExpense,
  postExpense,
  postExpenseAttachment,
  removeExpenseAttachment,
  removeExpense,
} from './expense.controller.js';

export const expenseRouter = Router({ mergeParams: true });
export const userExpenseRouter = Router();
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(
        new AppError(
          400,
          'INVALID_ATTACHMENT_TYPE',
          'Attachment must be JPEG, PNG, WebP, or GIF'
        )
      );
      return;
    }

    callback(null, true);
  },
});

userExpenseRouter.get('/recent', getRecentExpenses);

expenseRouter.get('/', getExpenses);
expenseRouter.post('/', postExpense);
expenseRouter.post(
  '/:expenseId/attachments',
  attachmentUpload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'attachments', maxCount: 5 },
  ]),
  postExpenseAttachment
);
expenseRouter.delete(
  '/:expenseId/attachments/:attachmentId',
  removeExpenseAttachment
);
expenseRouter.patch('/:expenseId', patchExpense);
expenseRouter.delete('/:expenseId', removeExpense);

import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../common/app-error.js';
import {
  getExpenses,
  patchExpense,
  postExpense,
  postExpenseAttachment,
  removeExpenseAttachment,
  removeExpense,
} from './expense.controller.js';

export const expenseRouter = Router({ mergeParams: true });
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

expenseRouter.get('/', getExpenses);
expenseRouter.post('/', postExpense);
expenseRouter.post(
  '/:expenseId/attachments',
  attachmentUpload.single('attachment'),
  postExpenseAttachment
);
expenseRouter.delete(
  '/:expenseId/attachments/:attachmentId',
  removeExpenseAttachment
);
expenseRouter.patch('/:expenseId', patchExpense);
expenseRouter.delete('/:expenseId', removeExpense);

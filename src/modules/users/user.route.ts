import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../common/app-error.js';
import {
  deleteBankAccountById,
  getBankAccounts,
  getUserLookup,
  getUsers,
  patchPassword,
  patchProfile,
  postBankAccount,
  postBankAccountQrDecode,
  postBankAccountQrImage,
  postAvatar,
} from './user.controller.js';

export const userRouter = Router();
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(new AppError(400, 'INVALID_AVATAR_TYPE', 'Avatar must be JPEG, PNG, WebP, or GIF'));
      return;
    }

    callback(null, true);
  },
});
const qrImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(new AppError(400, 'INVALID_QR_IMAGE_TYPE', 'QR image must be JPEG, PNG, WebP, or GIF'));
      return;
    }

    callback(null, true);
  },
});

userRouter.get('/lookup', getUserLookup);
userRouter.get('/', getUsers);
userRouter.patch('/me', patchProfile);
userRouter.patch('/me/password', patchPassword);
userRouter.post('/me/avatar', avatarUpload.single('avatar'), postAvatar);
userRouter.get('/me/bank-accounts', getBankAccounts);
userRouter.post('/me/bank-accounts', postBankAccount);
userRouter.post(
  '/me/bank-accounts/qr-decode',
  qrImageUpload.single('qr_image'),
  postBankAccountQrDecode
);
userRouter.delete('/me/bank-accounts/:bankAccountId', deleteBankAccountById);
userRouter.post(
  '/me/bank-accounts/:bankAccountId/qr-image',
  qrImageUpload.single('qr_image'),
  postBankAccountQrImage
);

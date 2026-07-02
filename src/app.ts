import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { healthRouter } from './routes/health.route.js';
import { authRouter } from './modules/auth/auth.route.js';
import { walletRouter } from './modules/wallets/wallet.route.js';
import { userRouter } from './modules/users/user.route.js';
import { authenticate } from './common/auth.middleware.js';
import { isAppError } from './common/app-error.js';
import { sendError } from './common/api-response.js';

export const app = express();

app.use(cors());
app.use(express.json());

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/api', authenticate);
app.use('/api/wallets', walletRouter);
app.use('/api/users', userRouter);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Uploaded file exceeds the allowed size limit'
          : error.message;
      return sendError(res, 400, 'FILE_UPLOAD_INVALID', message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
);

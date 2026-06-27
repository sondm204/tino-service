import { Router } from 'express';
import { authenticate } from '../../common/auth.middleware.js';
import {
  getMe,
  postLogin,
  postLogout,
  postRefresh,
  postRegister,
} from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', postRegister);
authRouter.post('/login', postLogin);
authRouter.post('/refresh', postRefresh);
authRouter.post('/logout', postLogout);
authRouter.get('/me', authenticate, getMe);

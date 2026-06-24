import { Router } from 'express';
import { getMe, postLogin, postLogout, postRegister } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', postRegister);
authRouter.post('/login', postLogin);
authRouter.post('/logout', postLogout);
authRouter.get('/me', getMe);

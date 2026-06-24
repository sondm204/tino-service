import { Router } from 'express';
import { getUsers, postUser } from './user.controller.js';

export const userRouter = Router();

userRouter.get('/', getUsers);
userRouter.post('/', postUser);

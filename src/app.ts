import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.route.js';
import { authRouter } from './modules/auth/auth.route.js';
import { groupRouter } from './modules/groups/group.route.js';
import { authenticate } from './common/auth.middleware.js';

export const app = express();

app.use(cors());
app.use(express.json());

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/api', authenticate);
app.use('/api/groups', groupRouter);

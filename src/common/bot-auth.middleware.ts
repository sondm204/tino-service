import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { sendError } from './api-response.js';

function secretsMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function authenticateBot(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const expectedSecret = process.env.TELEGRAM_BOT_SERVICE_SECRET;
  const actualSecret = req.header('x-tino-bot-secret') || '';

  if (!expectedSecret) {
    return sendError(
      res,
      503,
      'TELEGRAM_BOT_NOT_CONFIGURED',
      'Telegram bot integration is not configured'
    );
  }

  if (!secretsMatch(actualSecret, expectedSecret)) {
    return sendError(res, 401, 'BOT_UNAUTHORIZED', 'Invalid bot credentials');
  }

  next();
}

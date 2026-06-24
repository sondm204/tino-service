import type { Response } from 'express';

export type ApiResponse<T> = {
  message: string;
  code: string;
  data: T | null;
};

export function sendSuccess<T>(
  res: Response,
  status: number,
  code: string,
  message: string,
  data: T
) {
  return res.status(status).json({
    message,
    code,
    data,
  } satisfies ApiResponse<T>);
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string
) {
  return res.status(status).json({
    message,
    code,
    data: null,
  } satisfies ApiResponse<null>);
}

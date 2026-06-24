import { AppError } from './app-error.js';

export function getRequiredParam(
  params: Record<string, string | string[] | undefined>,
  name: string
) {
  const value = params[name];

  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', `${name} is required`);
  }

  return value;
}

import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getAuthenticatedUserId } from '../../common/auth.middleware.js';
import { getRequiredParam } from '../../common/request.js';
import {
  registerPushDevice,
  unregisterPushDevice,
} from './push-device.service.js';

function handleError(res: Response, error: unknown) {
  if (isAppError(error)) {
    return sendError(res, error.status, error.code, error.message);
  }

  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
}

export async function putPushDevice(req: Request, res: Response) {
  try {
    const data = await registerPushDevice(getAuthenticatedUserId(req), req.body);
    return sendSuccess(
      res,
      200,
      'PUSH_DEVICE_REGISTERED',
      'Push device registered successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function deletePushDevice(req: Request, res: Response) {
  try {
    const data = await unregisterPushDevice(
      getAuthenticatedUserId(req),
      getRequiredParam(req.params, 'deviceId')
    );
    return sendSuccess(
      res,
      200,
      'PUSH_DEVICE_UNREGISTERED',
      'Push device unregistered successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

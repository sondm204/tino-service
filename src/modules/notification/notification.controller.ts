import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getAuthenticatedUserId } from '../../common/auth.middleware.js';
import { getPageable } from '../../common/pageable.js';
import { getRequiredParam } from '../../common/request.js';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notification.service.js';

function handleError(res: Response, error: unknown) {
  if (isAppError(error)) {
    return sendError(res, error.status, error.code, error.message);
  }

  return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
}

export async function getNotifications(req: Request, res: Response) {
  try {
    const data = await listNotifications(
      getAuthenticatedUserId(req),
      getPageable(req)
    );
    return sendSuccess(
      res,
      200,
      'NOTIFICATION_LISTED',
      'Notifications fetched successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getUnreadCount(req: Request, res: Response) {
  try {
    const data = await getUnreadNotificationCount(
      getAuthenticatedUserId(req)
    );
    return sendSuccess(
      res,
      200,
      'NOTIFICATION_UNREAD_COUNTED',
      'Unread notifications counted successfully',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function patchNotificationRead(req: Request, res: Response) {
  try {
    const notificationId = getRequiredParam(req.params, 'notificationId');
    const data = await markNotificationRead(
      notificationId,
      getAuthenticatedUserId(req)
    );
    return sendSuccess(
      res,
      200,
      'NOTIFICATION_READ',
      'Notification marked as read',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

export async function patchAllNotificationsRead(req: Request, res: Response) {
  try {
    const data = await markAllNotificationsRead(getAuthenticatedUserId(req));
    return sendSuccess(
      res,
      200,
      'NOTIFICATION_ALL_READ',
      'All notifications marked as read',
      data
    );
  } catch (error) {
    return handleError(res, error);
  }
}

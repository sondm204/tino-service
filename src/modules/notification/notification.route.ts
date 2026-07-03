import { Router } from 'express';
import {
  getNotifications,
  getUnreadCount,
  patchAllNotificationsRead,
  patchNotificationRead,
} from './notification.controller.js';

export const notificationRouter = Router();

notificationRouter.get('/', getNotifications);
notificationRouter.get('/unread-count', getUnreadCount);
notificationRouter.patch('/read-all', patchAllNotificationsRead);
notificationRouter.patch('/:notificationId/read', patchNotificationRead);

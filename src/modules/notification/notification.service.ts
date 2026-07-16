import { AppError } from '../../common/app-error.js';
import {
  type PageableRequest,
  toPageableResponse,
  toSupabaseRange,
} from '../../common/pageable.js';
import { supabase } from '../../db/supabase.js';
import { sendPushForNotifications } from '../push-devices/push-device.service.js';

export type NotificationStatus = 'UNREAD' | 'READ';
export type NotificationType =
  | 'EXPENSE_CREATED'
  | 'EXPENSE_UPDATED'
  | 'SYSTEM';

export type Notification = {
  id: string;
  user_id: string;
  created_by: string | null;
  type: NotificationType;
  title: string;
  message: string;
  status: NotificationStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  creator?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
};

export interface CreateNotificationInput {
  user_id: string;
  created_by?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export async function createNotification(input: CreateNotificationInput) {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: input.user_id,
      created_by: input.created_by ?? null,
      type: input.type,
      title: input.title.trim(),
      message: input.message.trim(),
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError(
      400,
      'NOTIFICATION_CREATE_FAILED',
      error?.message || 'Could not create notification'
    );
  }

  const notification = data as Notification;

  try {
    await sendPushForNotifications([notification]);
  } catch (error) {
    console.error('Could not send push notification', error);
  }

  return notification;
}

export async function createNotifications(inputs: CreateNotificationInput[]) {
  if (inputs.length === 0) return [];

  const { data, error } = await supabase
    .from('notifications')
    .insert(
      inputs.map((input) => ({
        user_id: input.user_id,
        created_by: input.created_by ?? null,
        type: input.type,
        title: input.title.trim(),
        message: input.message.trim(),
        metadata: input.metadata ?? {},
      }))
    )
    .select('*');

  if (error) {
    throw new AppError(400, 'NOTIFICATION_CREATE_FAILED', error.message);
  }

  const notifications = (data ?? []) as Notification[];

  try {
    await sendPushForNotifications(notifications);
  } catch (error) {
    console.error('Could not send push notifications', error);
  }

  return notifications;
}

export async function listNotifications(
  userId: string,
  pageable: PageableRequest
) {
  const { from, to } = toSupabaseRange(pageable);
  const { data, error, count } = await supabase
    .from('notifications')
    .select(
      `
        *,
        creator:users!notifications_created_by_fkey (
          id,
          display_name,
          avatar_url
        )
      `,
      { count: 'exact' }
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    throw new AppError(400, 'NOTIFICATION_LIST_FAILED', error.message);
  }

  return toPageableResponse(
    (data ?? []) as Notification[],
    pageable,
    count ?? 0
  );
}

export async function getUnreadNotificationCount(userId: string) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'UNREAD');

  if (error) {
    throw new AppError(400, 'NOTIFICATION_COUNT_FAILED', error.message);
  }

  return { count: count ?? 0 };
}

export async function markNotificationRead(
  notificationId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from('notifications')
    .update({
      status: 'READ',
      read_at: new Date().toISOString(),
    })
    .eq('id', notificationId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError(
      404,
      'NOTIFICATION_NOT_FOUND',
      'Notification not found'
    );
  }

  return data as Notification;
}

export async function markAllNotificationsRead(userId: string) {
  const readAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('notifications')
    .update({ status: 'READ', read_at: readAt })
    .eq('user_id', userId)
    .eq('status', 'UNREAD')
    .select('id');

  if (error) {
    throw new AppError(400, 'NOTIFICATION_UPDATE_FAILED', error.message);
  }

  return { updated: data?.length ?? 0, read_at: readAt };
}


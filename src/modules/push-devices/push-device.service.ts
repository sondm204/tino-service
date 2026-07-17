import { AppError } from '../../common/app-error.js';
import { supabase } from '../../db/supabase.js';
import type { Notification } from '../notification/notification.service.js';
import { sendFirebasePush } from './firebase-push.service.js';

export type PushDevicePlatform = 'ios' | 'android' | 'web';

export type PushDevice = {
  id: string;
  user_id: string;
  device_id: string;
  platform: PushDevicePlatform;
  fcm_token: string;
  app_version: string | null;
  device_name: string | null;
  last_seen_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string | null;
};

export type RegisterPushDeviceInput = {
  device_id?: string;
  platform?: string;
  fcm_token?: string;
  app_version?: string | null;
  device_name?: string | null;
};

type PushDeviceTokenRow = {
  user_id: string;
  fcm_token: string;
  platform: PushDevicePlatform;
};

const validPlatforms = new Set(['ios', 'android', 'web']);

function requireText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} is required`);
  }

  return value.trim();
}

export async function registerPushDevice(
  userId: string,
  input: RegisterPushDeviceInput
) {
  const deviceId = requireText(input.device_id, 'device_id');
  const fcmToken = requireText(input.fcm_token, 'fcm_token');
  const platform = requireText(input.platform, 'platform');

  if (!validPlatforms.has(platform)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'platform is invalid');
  }

  const now = new Date().toISOString();

  await supabase
    .from('user_push_devices')
    .update({ revoked_at: now, updated_at: now })
    .eq('device_id', deviceId)
    .neq('user_id', userId)
    .is('revoked_at', null);

  const { data, error } = await supabase
    .from('user_push_devices')
    .upsert(
      {
        user_id: userId,
        device_id: deviceId,
        platform,
        fcm_token: fcmToken,
        app_version: input.app_version?.trim() || null,
        device_name: input.device_name?.trim() || null,
        last_seen_at: now,
        revoked_at: null,
        updated_at: now,
      },
      { onConflict: 'user_id,device_id' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new AppError(
      400,
      'PUSH_DEVICE_REGISTER_FAILED',
      error?.message || 'Could not register push device'
    );
  }

  return data as PushDevice;
}

export async function unregisterPushDevice(userId: string, deviceId: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('user_push_devices')
    .update({ revoked_at: now, updated_at: now })
    .eq('user_id', userId)
    .eq('device_id', deviceId.trim())
    .is('revoked_at', null)
    .select('id');

  if (error) {
    throw new AppError(400, 'PUSH_DEVICE_UNREGISTER_FAILED', error.message);
  }

  return { revoked: data?.length ?? 0 };
}

export async function sendPushForNotifications(notifications: Notification[]) {
  if (notifications.length === 0) return;

  const userIds = [...new Set(notifications.map((item) => item.user_id))];
  const { data, error } = await supabase
    .from('user_push_devices')
    .select('user_id, fcm_token, platform')
    .in('user_id', userIds)
    .is('revoked_at', null);

  if (error) {
    console.error('Could not load push devices', error.message);
    return;
  }

  const tokensByUser = new Map<string, PushDeviceTokenRow[]>();

  for (const row of (data ?? []) as PushDeviceTokenRow[]) {
    const tokens = tokensByUser.get(row.user_id) ?? [];
    tokens.push(row);
    tokensByUser.set(row.user_id, tokens);
  }

  const invalidTokens = new Set<string>();

  await Promise.all(
    notifications.map(async (notification) => {
      const devices = tokensByUser.get(notification.user_id) ?? [];

      if (devices.length === 0) {
        return;
      }

      const mobileTokens = devices
        .filter((device) => device.platform !== 'web')
        .map((device) => device.fcm_token);
      const webTokens = devices
        .filter((device) => device.platform === 'web')
        .map((device) => device.fcm_token);

      try {
        const results = await Promise.all([
          sendFirebasePush(mobileTokens, notification),
          sendFirebasePush(webTokens, notification, {
            includeNotificationPayload: false,
          }),
        ]);

        for (const result of results) {
          result.invalidTokens.forEach((token) => invalidTokens.add(token));
        }
      } catch (error) {
        console.error('Could not send push notification', error);
      }
    })
  );

  if (invalidTokens.size > 0) {
    const now = new Date().toISOString();
    const { error: revokeError } = await supabase
      .from('user_push_devices')
      .update({ revoked_at: now, updated_at: now })
      .in('fcm_token', [...invalidTokens])
      .is('revoked_at', null);

    if (revokeError) {
      console.error('Could not revoke invalid push tokens', revokeError.message);
    }
  }
}

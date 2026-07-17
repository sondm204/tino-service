import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Notification } from '../notification/notification.service.js';

type PushSendResult = {
  invalidTokens: string[];
  failureCount: number;
  successCount: number;
};

type SendFirebasePushOptions = {
  includeNotificationPayload?: boolean;
};

let firebaseInitAttempted = false;

function getFirebaseMessaging() {
  if (!firebaseInitAttempted) {
    firebaseInitAttempted = true;

    if (getApps().length === 0) {
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

      if (serviceAccountJson) {
        const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
        initializeApp({ credential: cert(serviceAccount) });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        initializeApp({ credential: applicationDefault() });
      }
    }
  }

  if (getApps().length === 0) {
    return null;
  }

  return getMessaging();
}

function toFcmData(notification: Notification) {
  const data: Record<string, string> = {
    body: notification.message,
    notification_id: notification.id,
    title: notification.title,
    type: notification.type,
  };

  for (const [key, value] of Object.entries(notification.metadata ?? {})) {
    if (value === null || value === undefined) continue;
    data[key] =
      typeof value === 'string' ? value : JSON.stringify(value);
  }

  return data;
}

export async function sendFirebasePush(
  tokens: string[],
  notification: Notification,
  options: SendFirebasePushOptions = {}
): Promise<PushSendResult> {
  const messaging = getFirebaseMessaging();

  if (!messaging || tokens.length === 0) {
    if (tokens.length > 0) {
      console.warn(
        'Firebase push skipped because Firebase Admin is not configured'
      );
    }

    return { invalidTokens: [], failureCount: 0, successCount: 0 };
  }

  const includeNotificationPayload =
    options.includeNotificationPayload ?? true;
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: includeNotificationPayload
      ? {
          title: notification.title,
          body: notification.message,
        }
      : undefined,
    data: toFcmData(notification),
    android: {
      priority: 'high',
      notification: {
        channelId: 'default',
      },
    },
  });

  const invalidTokens = response.responses
    .map((result, index) => {
      const code = result.error?.code;

      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        return tokens[index];
      }

      if (result.error) {
        console.error('Firebase push failed', result.error);
      }

      return null;
    })
    .filter((token): token is string => Boolean(token));

  return {
    invalidTokens,
    failureCount: response.failureCount,
    successCount: response.successCount,
  };
}

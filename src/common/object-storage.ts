import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { AppError } from './app-error.js';

function getStorageConfig() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region = process.env.S3_REGION?.trim() || 'us-east-1';
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL
    ?.trim()
    .replace(/\/$/, '');
  const forcePathStyle =
    process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === 'true';

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new AppError(
      503,
      'OBJECT_STORAGE_NOT_CONFIGURED',
      'Object storage is not configured'
    );
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    forcePathStyle,
  };
}

function getPublicUrl(
  key: string,
  config: ReturnType<typeof getStorageConfig>
) {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/${key}`;
  }

  if (config.endpoint) {
    return config.forcePathStyle
      ? `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${key}`
      : `${config.endpoint.replace(/\/$/, '')}/${key}`;
  }

  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
}

export async function uploadUserAvatar(
  userId: string,
  file: Express.Multer.File
) {
  const config = getStorageConfig();
  const extension = extname(file.originalname).toLowerCase();
  const safeExtension = extension && extension.length <= 6 ? extension : '';
  const key = `users/${userId}/avatars/${randomUUID()}${safeExtension}`;
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  } catch (error) {
    console.error('S3 avatar upload failed', {
      bucket: config.bucket,
      endpoint: config.endpoint || 'AWS default',
      error: error instanceof Error ? error.message : String(error),
      region: config.region,
    });
    throw new AppError(502, 'AVATAR_UPLOAD_FAILED', 'Could not upload avatar');
  }

  return {
    key,
    url: getPublicUrl(key, config),
  };
}

export async function uploadExpenseAttachment(
  walletId: string,
  expenseId: string,
  file: Express.Multer.File
) {
  const config = getStorageConfig();
  const extension = extname(file.originalname).toLowerCase();
  const safeExtension = extension && extension.length <= 6 ? extension : '';
  const key = `wallets/${walletId}/expenses/${expenseId}/${randomUUID()}${safeExtension}`;
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  } catch (error) {
    const storageError = error as {
      name?: string;
      message?: string;
      $metadata?: {
        httpStatusCode?: number;
        requestId?: string;
        extendedRequestId?: string;
      };
    };
    console.error('S3 expense attachment upload failed', {
      bucket: config.bucket,
      endpoint: config.endpoint || 'AWS default',
      error: storageError.message || String(error),
      errorName: storageError.name,
      forcePathStyle: config.forcePathStyle,
      httpStatusCode: storageError.$metadata?.httpStatusCode,
      key,
      region: config.region,
      requestId: storageError.$metadata?.requestId,
      extendedRequestId: storageError.$metadata?.extendedRequestId,
    });
    throw new AppError(502, 'ATTACHMENT_UPLOAD_FAILED', 'Could not upload attachment');
  }

  return { key, url: getPublicUrl(key, config) };
}

export async function uploadBankAccountQrImage(
  userId: string,
  bankAccountId: string,
  file: Express.Multer.File
) {
  const config = getStorageConfig();
  const extension = extname(file.originalname).toLowerCase();
  const safeExtension = extension && extension.length <= 6 ? extension : '';
  const key = `users/${userId}/bank-accounts/${bankAccountId}/${randomUUID()}${safeExtension}`;
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  } catch (error) {
    console.error('S3 bank QR upload failed', {
      bucket: config.bucket,
      endpoint: config.endpoint || 'AWS default',
      error: error instanceof Error ? error.message : String(error),
      key,
      region: config.region,
    });
    throw new AppError(502, 'BANK_QR_UPLOAD_FAILED', 'Could not upload bank QR image');
  }

  return { key, url: getPublicUrl(key, config) };
}

export async function deleteObject(key: string) {
  const config = getStorageConfig();
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      })
    );
  } catch (error) {
    console.error('S3 object deletion failed', {
      error: error instanceof Error ? error.message : String(error),
      key,
    });
    throw new AppError(502, 'OBJECT_DELETE_FAILED', 'Could not delete stored object');
  }
}

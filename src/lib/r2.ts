// Cloudflare R2 wrapper — S3-compatible API for bill file storage.
//
// SERVER ONLY. Do not import from 'use client' components — the AWS SDK
// pulls in node:stream/crypto/buffer and will break in a browser bundle.
//
// Construction is lazy (via Proxy): R2 credentials are read on first use,
// not at module load. Mirrors the prisma.ts wrapper rationale — Next.js
// build-time page-data collection imports route modules to extract metadata;
// if construction were eager, a missing env at collection time would crash
// the build even when the env is present for actual request handling.
//
// Public API:
//   - generatePresignedPutUrl(key, contentType, contentLengthBytes)
//       → URL valid 10 minutes; browser uploads directly to R2.
//   - generatePresignedGetUrl(key, expirySeconds?)
//       → URL valid 1 hour by default; for inline viewing.
//   - headObject(key)
//       → { contentType, contentLength } or null if missing.
//   - deleteObject(key)
//       → idempotent; treats 404 as success.

import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  NotFound,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGNED_PUT_EXPIRY_SECONDS = 600; // 10 minutes
const PRESIGNED_GET_EXPIRY_SECONDS_DEFAULT = 3600; // 1 hour

const globalForR2 = globalThis as unknown as {
  r2Client: S3Client | undefined;
  r2Bucket: string | undefined;
};

function createR2Client(): { client: S3Client; bucket: string } {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT_URL;

  if (!accountId) throw new Error("R2_ACCOUNT_ID is not set");
  if (!accessKeyId) throw new Error("R2_ACCESS_KEY_ID is not set");
  if (!secretAccessKey) throw new Error("R2_SECRET_ACCESS_KEY is not set");
  if (!bucket) throw new Error("R2_BUCKET_NAME is not set");
  if (!endpoint) throw new Error("R2_ENDPOINT_URL is not set");

  // R2 requires region "auto" and path-style addressing.
  const config: S3ClientConfig = {
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  };

  return { client: new S3Client(config), bucket };
}

function getR2(): { client: S3Client; bucket: string } {
  if (globalForR2.r2Client && globalForR2.r2Bucket) {
    return { client: globalForR2.r2Client, bucket: globalForR2.r2Bucket };
  }
  const { client, bucket } = createR2Client();
  globalForR2.r2Client = client;
  globalForR2.r2Bucket = bucket;
  return { client, bucket };
}

export async function generatePresignedPutUrl(
  key: string,
  contentType: string,
  contentLengthBytes: number,
): Promise<string> {
  const { client, bucket } = getR2();
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLengthBytes,
  });
  return getSignedUrl(client, cmd, {
    expiresIn: PRESIGNED_PUT_EXPIRY_SECONDS,
  });
}

export async function generatePresignedGetUrl(
  key: string,
  expirySeconds: number = PRESIGNED_GET_EXPIRY_SECONDS_DEFAULT,
): Promise<string> {
  const { client, bucket } = getR2();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn: expirySeconds });
}

export type R2HeadResult = {
  contentType: string;
  contentLength: number;
};

export async function headObject(key: string): Promise<R2HeadResult | null> {
  const { client, bucket } = getR2();
  try {
    const res = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      contentType: res.ContentType ?? "",
      contentLength: Number(res.ContentLength ?? 0),
    };
  } catch (err) {
    if (err instanceof NotFound) return null;
    // Some S3-compatible endpoints surface 404 via a generic error with $metadata.
    const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
    if (meta?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = getR2();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    // S3 DELETE is idempotent and returns 204 even for missing keys; some
    // S3-compatibles still surface NotFound — swallow it.
    if (err instanceof NotFound) return;
    const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
    if (meta?.httpStatusCode === 404) return;
    throw err;
  }
}

// Tests for the lazy-init R2 wrapper. Mocks @aws-sdk/client-s3 and
// @aws-sdk/s3-request-presigner at the SDK boundary so no real network
// calls happen. Resets the wrapper's singleton cache between tests so
// each test sees a fresh client construction.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@aws-sdk/client-s3");
  // Each Command mock must be constructible (the wrapper does
  // `new HeadObjectCommand(...)`). Arrow functions can't be `new`'d,
  // so we use plain `function` expressions and exploit the JS rule that
  // an explicit object return from a constructor becomes the instance.
  return {
    ...actual,
    S3Client: vi.fn(),
    PutObjectCommand: vi.fn(function (input: unknown) {
      return { __cmd: "Put", input };
    }),
    GetObjectCommand: vi.fn(function (input: unknown) {
      return { __cmd: "Get", input };
    }),
    HeadObjectCommand: vi.fn(function (input: unknown) {
      return { __cmd: "Head", input };
    }),
    DeleteObjectCommand: vi.fn(function (input: unknown) {
      return { __cmd: "Delete", input };
    }),
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

// Shape of the wrapper's singleton cache on globalThis. Mirroring this so
// tests can clear it without poking at internals.
type R2Globals = {
  r2Client: unknown;
  r2Bucket: unknown;
};

function clearR2Cache() {
  const g = globalThis as unknown as R2Globals;
  delete (g as Record<string, unknown>).r2Client;
  delete (g as Record<string, unknown>).r2Bucket;
}

const VALID_ENV = {
  R2_ACCOUNT_ID: "acc-12345",
  R2_ACCESS_KEY_ID: "AKIA-test",
  R2_SECRET_ACCESS_KEY: "secret-test-key",
  R2_BUCKET_NAME: "test-bucket",
  R2_ENDPOINT_URL: "https://acc-12345.r2.cloudflarestorage.com",
};

let sendMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearR2Cache();
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(VALID_ENV)) process.env[k] = v;

  sendMock = vi.fn();
  // S3Client is invoked via `new S3Client(...)` in the wrapper. Arrow
  // functions can't be constructed, so the implementation must be a
  // regular function expression. JS lets constructors explicitly return
  // an object — that's what we exploit here.
  vi.mocked(S3Client).mockImplementation(function (
    this: { send: typeof sendMock },
  ) {
    this.send = sendMock;
  } as unknown as typeof S3Client);
  vi.mocked(getSignedUrl).mockResolvedValue(
    "https://signed.example/abc?X-Amz-Signature=...",
  );
});

describe("R2 wrapper — lazy-init", () => {
  it("constructs S3Client with region=auto, forcePathStyle, and provided credentials on first use", async () => {
    const { generatePresignedPutUrl } = await import("./r2");
    await generatePresignedPutUrl("bills/2026/05/key", "application/pdf", 123);

    expect(S3Client).toHaveBeenCalledTimes(1);
    const config = vi.mocked(S3Client).mock.calls[0][0];
    expect(config?.region).toBe("auto");
    expect(config?.forcePathStyle).toBe(true);
    expect(config?.endpoint).toBe(VALID_ENV.R2_ENDPOINT_URL);
    // Credentials are an object, not a closure, so equality is shallow.
    const creds = config?.credentials as {
      accessKeyId: string;
      secretAccessKey: string;
    };
    expect(creds.accessKeyId).toBe(VALID_ENV.R2_ACCESS_KEY_ID);
    expect(creds.secretAccessKey).toBe(VALID_ENV.R2_SECRET_ACCESS_KEY);
  });

  it("reuses the cached client on second call (does NOT re-construct)", async () => {
    const { generatePresignedPutUrl, headObject } = await import("./r2");
    await generatePresignedPutUrl("k1", "application/pdf", 1);
    sendMock.mockResolvedValueOnce({ ContentType: "application/pdf", ContentLength: 1 });
    await headObject("k2");

    expect(S3Client).toHaveBeenCalledTimes(1);
  });

  it("throws clearly when R2_ACCOUNT_ID is unset", async () => {
    delete process.env.R2_ACCOUNT_ID;
    const { generatePresignedPutUrl } = await import("./r2");
    await expect(
      generatePresignedPutUrl("k", "image/png", 1),
    ).rejects.toThrow("R2_ACCOUNT_ID is not set");
  });

  it("throws clearly when R2_BUCKET_NAME is unset", async () => {
    delete process.env.R2_BUCKET_NAME;
    const { generatePresignedPutUrl } = await import("./r2");
    await expect(
      generatePresignedPutUrl("k", "image/png", 1),
    ).rejects.toThrow("R2_BUCKET_NAME is not set");
  });
});

describe("generatePresignedPutUrl", () => {
  it("signs PUT with the requested Content-Type + Content-Length and a 600s expiry", async () => {
    const { generatePresignedPutUrl } = await import("./r2");
    const url = await generatePresignedPutUrl(
      "bills/2026/05/abc-receipt.pdf",
      "application/pdf",
      4096,
    );

    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: VALID_ENV.R2_BUCKET_NAME,
      Key: "bills/2026/05/abc-receipt.pdf",
      ContentType: "application/pdf",
      ContentLength: 4096,
    });
    // Signer call: (client, command, options)
    const [, , opts] = vi.mocked(getSignedUrl).mock.calls[0];
    expect(opts?.expiresIn).toBe(600);
    expect(url).toMatch(/^https:\/\/signed\.example/);
  });
});

describe("generatePresignedGetUrl", () => {
  it("signs GET with the default 3600s expiry when none is provided", async () => {
    const { generatePresignedGetUrl } = await import("./r2");
    await generatePresignedGetUrl("bills/2026/05/x");
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: VALID_ENV.R2_BUCKET_NAME,
      Key: "bills/2026/05/x",
    });
    const [, , opts] = vi.mocked(getSignedUrl).mock.calls[0];
    expect(opts?.expiresIn).toBe(3600);
  });

  it("honors a custom expirySeconds override", async () => {
    const { generatePresignedGetUrl } = await import("./r2");
    await generatePresignedGetUrl("bills/2026/05/x", 120);
    const [, , opts] = vi.mocked(getSignedUrl).mock.calls[0];
    expect(opts?.expiresIn).toBe(120);
  });
});

describe("headObject", () => {
  it("returns { contentType, contentLength } when the object exists", async () => {
    sendMock.mockResolvedValueOnce({
      ContentType: "image/png",
      ContentLength: 70,
    });
    const { headObject } = await import("./r2");
    const result = await headObject("bills/2026/05/png");
    expect(result).toEqual({ contentType: "image/png", contentLength: 70 });
    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: VALID_ENV.R2_BUCKET_NAME,
      Key: "bills/2026/05/png",
    });
  });

  it("returns null when the SDK throws NotFound (typed)", async () => {
    sendMock.mockRejectedValueOnce(
      new NotFound({ message: "Not Found", $metadata: {} }),
    );
    const { headObject } = await import("./r2");
    const result = await headObject("missing");
    expect(result).toBeNull();
  });

  it("returns null when an opaque error carries $metadata.httpStatusCode=404", async () => {
    const opaque = Object.assign(new Error("not found"), {
      $metadata: { httpStatusCode: 404 },
    });
    sendMock.mockRejectedValueOnce(opaque);
    const { headObject } = await import("./r2");
    const result = await headObject("missing");
    expect(result).toBeNull();
  });

  it("rethrows non-404 errors so the action surface can decide", async () => {
    sendMock.mockRejectedValueOnce(new Error("transient network error"));
    const { headObject } = await import("./r2");
    await expect(headObject("k")).rejects.toThrow("transient network error");
  });
});

describe("deleteObject", () => {
  it("sends a DeleteObjectCommand and resolves on success", async () => {
    sendMock.mockResolvedValueOnce({});
    const { deleteObject } = await import("./r2");
    await expect(deleteObject("bills/2026/05/x")).resolves.toBeUndefined();
    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: VALID_ENV.R2_BUCKET_NAME,
      Key: "bills/2026/05/x",
    });
  });

  it("swallows NotFound to keep the operation idempotent", async () => {
    sendMock.mockRejectedValueOnce(
      new NotFound({ message: "Not Found", $metadata: {} }),
    );
    const { deleteObject } = await import("./r2");
    await expect(deleteObject("gone")).resolves.toBeUndefined();
  });

  it("swallows opaque 404 errors via $metadata.httpStatusCode", async () => {
    const opaque = Object.assign(new Error("not found"), {
      $metadata: { httpStatusCode: 404 },
    });
    sendMock.mockRejectedValueOnce(opaque);
    const { deleteObject } = await import("./r2");
    await expect(deleteObject("gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors so the caller can log + tombstone safely", async () => {
    sendMock.mockRejectedValueOnce(new Error("AccessDenied"));
    const { deleteObject } = await import("./r2");
    await expect(deleteObject("k")).rejects.toThrow("AccessDenied");
  });
});

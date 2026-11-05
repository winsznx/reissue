import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { AppConfig } from "./config.js";

/**
 * Content-addressed object storage. Source files are written once under their SHA-256 and
 * never overwritten, which is what makes "original bytes unchanged" checkable.
 */
export class ObjectStore {
  private readonly s3: S3Client;

  constructor(
    config: Pick<AppConfig, "S3_ENDPOINT" | "S3_REGION" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY">,
    readonly bucket: string,
  ) {
    this.s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (error as { name?: string }).name === "NotFound") return false;
      throw error;
    }
  }

  async putImmutable(key: string, bytes: Buffer, mime: string, sha256: string): Promise<void> {
    if (await this.exists(key)) return;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
        Metadata: { sha256 },
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) throw new Error(`Object ${key} has no body`);
    return Buffer.from(await out.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async ping(): Promise<number> {
    const started = performance.now();
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return performance.now() - started;
  }
}

export const blobKey = (sha256: string): string => `blobs/${sha256.slice(0, 2)}/${sha256}`;
/** Content-addressed so a regenerated artifact can never be shadowed by an earlier attempt's bytes. */
export const artifactKey = (shipmentId: string, epoch: number, sha256: string, filename: string): string =>
  `artifacts/${shipmentId}/e${epoch}/${sha256}/${filename}`;

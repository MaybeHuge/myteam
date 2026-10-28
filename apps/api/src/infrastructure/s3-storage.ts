import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ApiException } from '../common/http.js';
import { attachmentMetadata } from './attachment-file.js';

@Injectable()
export class S3Storage implements OnModuleDestroy {
  private readonly client: S3Client;
  readonly bucket: string;
  readonly prefix: string;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.bucket = config.S3_BUCKET;
    this.prefix = config.S3_PREFIX;
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 3000, requestTimeout: 30000 },
      maxAttempts: 2,
    });
  }
  onModuleDestroy() {
    this.client.destroy();
  }
  private key(key: string) {
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/[a-f0-9-]{36}\.bin$/.test(key) || key.length > 80)
      throw new ApiException(400, 'VALIDATION_ERROR', '文件标识无效');
    return key;
  }
  private unavailable(): never {
    throw new ApiException(503, 'SERVICE_UNAVAILABLE', '附件存储暂不可用，请稍后重试');
  }
  async ready() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      this.unavailable();
    }
  }
  // 仅显式初始化命令和隔离测试调用，正常请求不会创建存储桶。
  async initialize() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
        this.unavailable();
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (createError) {
        if (!['BucketAlreadyOwnedByYou'].includes((createError as Error).name)) this.unavailable();
      }
    }
  }
  async put(filename: string, content: Buffer) {
    const metadata = attachmentMetadata(filename, content);
    const storageKey = `${this.prefix}${randomUUID()}.bin`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: content,
          ContentLength: content.length,
          ContentType: metadata.contentType,
          Metadata: { sha256: metadata.sha256 },
        }),
      );
    } catch {
      // 上传响应丢失也可能已写对象；此键从未交给业务事务，可安全尝试删除。
      try {
        await this.remove(storageKey);
      } catch {
        /* 后续按保护窗口清理 */
      }
      this.unavailable();
    }
    return { storageKey, storageBucket: this.bucket, ...metadata };
  }
  async remove(key: string) {
    this.key(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      this.unavailable();
    }
  }
  async stream(key: string, bucket = this.bucket) {
    this.key(key);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!(result.Body instanceof Readable)) this.unavailable();
      return result.Body;
    } catch (error) {
      if ((error as Error).name === 'NoSuchKey')
        throw new ApiException(404, 'NOT_FOUND', '附件文件不存在，请联系管理员检查存储');
      this.unavailable();
    }
  }
  async get(key: string) {
    const stream = await this.stream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  async *objects() {
    let token: string | undefined;
    do {
      let result;
      try {
        result = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: this.prefix,
            ContinuationToken: token,
          }),
        );
      } catch {
        this.unavailable();
      }
      for (const object of result.Contents ?? [])
        if (object.Key && object.LastModified)
          yield { key: object.Key, modifiedAt: object.LastModified };
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
  }
  async prune(
    isReferenced: (key: string) => Promise<boolean>,
    olderThan = new Date(Date.now() - 24 * 3600000),
  ) {
    let removed = 0;
    for await (const object of this.objects()) {
      if (
        object.modifiedAt >= olderThan ||
        !/^[a-f0-9-]{36}\.bin$/.test(object.key.slice(this.prefix.length))
      )
        continue;
      // 在删除前查询最新引用；只处理本应用前缀且超过保护窗口的随机键。
      if (!(await isReferenced(object.key))) {
        await this.remove(object.key);
        removed++;
      }
    }
    return removed;
  }
}

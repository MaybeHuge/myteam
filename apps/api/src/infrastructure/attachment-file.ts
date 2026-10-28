import { createHash } from 'node:crypto';
import { ApiException } from '../common/http.js';

export function attachmentMetadata(filename: string, content: Buffer) {
  const maxSize = 20 * 1024 * 1024;
  if (!content.length || content.length > maxSize)
    throw new ApiException(400, 'VALIDATION_ERROR', '附件大小须在 1 字节至 20 MiB 之间');
  let contentType: string;
  if (
    /\.png$/i.test(filename) &&
    content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  )
    contentType = 'image/png';
  else if (
    /\.jpe?g$/i.test(filename) &&
    content.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
  )
    contentType = 'image/jpeg';
  else if (
    /\.webp$/i.test(filename) &&
    content.subarray(0, 4).toString() === 'RIFF' &&
    content.subarray(8, 12).toString() === 'WEBP'
  )
    contentType = 'image/webp';
  else if (/\.pdf$/i.test(filename) && content.subarray(0, 5).toString() === '%PDF-')
    contentType = 'application/pdf';
  else if (/\.(txt|md)$/i.test(filename)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      throw new ApiException(400, 'VALIDATION_ERROR', '文本附件必须为 UTF-8');
    }
    contentType = 'text/plain';
  } else throw new ApiException(400, 'VALIDATION_ERROR', '文件类型或内容格式不受支持');
  return {
    filename,
    contentType,
    size: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

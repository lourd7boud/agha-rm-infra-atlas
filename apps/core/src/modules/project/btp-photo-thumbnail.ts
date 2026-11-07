import { Readable } from 'node:stream';
import sharp from 'sharp';
import type { FetchedObject, ObjectStorage } from '../vault/storage';

const THUMBNAIL_SIZE = 640;

export function photoThumbnailKey(originalKey: string): string {
  return `${originalKey}.thumb-${THUMBNAIL_SIZE}-v1.webp`;
}

async function streamBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getOrCreatePhotoThumbnail(
  storage: ObjectStorage,
  originalKey: string,
): Promise<FetchedObject> {
  const thumbnailKey = photoThumbnailKey(originalKey);
  if (await storage.exists(thumbnailKey)) {
    return storage.getObject(thumbnailKey);
  }

  const original = await storage.getObject(originalKey);
  const thumbnail = await sharp(await streamBuffer(original.body))
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: true,
    })
    .webp({ quality: 76, effort: 4 })
    .toBuffer();
  await storage.put(thumbnailKey, thumbnail, 'image/webp');

  return {
    body: Readable.from(thumbnail),
    mime: 'image/webp',
    sizeBytes: thumbnail.length,
  };
}

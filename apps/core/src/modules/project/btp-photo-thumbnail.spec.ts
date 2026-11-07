import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage, type FetchedObject } from '../vault/storage';
import { BtpAssetsController } from './btp-registres.controller';
import type { AssetRecord, BtpAssetsRepository } from './btp-assets.repository';
import { getOrCreatePhotoThumbnail, photoThumbnailKey } from './btp-photo-thumbnail';

async function bodyBuffer(object: FetchedObject): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('photo thumbnails', () => {
  it('serves a 640px square WebP instead of the full-resolution photo', async () => {
    const storage = new InMemoryObjectStorage();
    const originalKey = 'btp/project/photo.jpg';
    const original = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: { r: 180, g: 120, b: 60 },
      },
    })
      .jpeg({ quality: 92 })
      .toBuffer();
    await storage.put(originalKey, original, 'image/jpeg');

    const thumbnail = await getOrCreatePhotoThumbnail(storage, originalKey);
    const output = await bodyBuffer(thumbnail);
    const metadata = await sharp(output).metadata();

    expect(thumbnail.mime).toBe('image/webp');
    expect(metadata).toMatchObject({ format: 'webp', width: 640, height: 640 });
    expect(output.length).toBeLessThan(original.length);
    await expect(storage.exists(photoThumbnailKey(originalKey))).resolves.toBe(true);
  });

  it('reuses the cached thumbnail without reading the original again', async () => {
    const storage = new InMemoryObjectStorage();
    const originalKey = 'btp/project/photo.jpg';
    const original = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: { r: 40, g: 100, b: 180 },
      },
    })
      .jpeg()
      .toBuffer();
    await storage.put(originalKey, original, 'image/jpeg');
    const first = await bodyBuffer(await getOrCreatePhotoThumbnail(storage, originalKey));
    await storage.delete(originalKey);

    const second = await bodyBuffer(await getOrCreatePhotoThumbnail(storage, originalKey));

    expect(second.equals(first)).toBe(true);
  });

  it('exposes the optimized thumbnail through the assets controller', async () => {
    const storage = new InMemoryObjectStorage();
    const asset: AssetRecord = {
      id: 'photo-1',
      projectId: 'project-1',
      type: 'photo',
      fileName: 'photo.jpg',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 100,
      storageKey: 'btp/project/photo.jpg',
      albumId: null,
      metadata: {},
      createdBy: 'tester',
      createdAt: new Date(),
    };
    await storage.put(
      asset.storageKey!,
      await sharp({
        create: {
          width: 1600,
          height: 1200,
          channels: 3,
          background: { r: 80, g: 140, b: 70 },
        },
      })
        .jpeg()
        .toBuffer(),
      'image/jpeg',
    );
    const repository = {
      getAsset: async () => asset,
    } as unknown as BtpAssetsRepository;
    const controller = new BtpAssetsController(repository, storage);

    const response = await controller.thumbnailAsset('project-1', 'photo-1');
    const output = await bodyBuffer({
      body: response.getStream(),
      mime: response.getHeaders().type,
    });

    expect(response.getHeaders().type).toBe('image/webp');
    await expect(sharp(output).metadata()).resolves.toMatchObject({ width: 640, height: 640 });
  });
});

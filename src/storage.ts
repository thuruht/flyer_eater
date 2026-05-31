import type { Env } from './types';

export interface UploadResult {
  r2Key: string;
  imageUrl: string;
}

export async function uploadFlyerToR2(
  env: Env,
  imageBuffer: ArrayBuffer,
  mimeType: string,
  originalFilename: string
): Promise<UploadResult> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const ext = originalFilename.split('.').pop() ?? 'jpg';
  const r2Key = `flyers/${timestamp}-${random}.${ext}`;

  await env.IMAGES.put(r2Key, imageBuffer, {
    httpMetadata: { contentType: mimeType }
  });

  return {
    r2Key,
    imageUrl: `/images/${r2Key}`
  };
}

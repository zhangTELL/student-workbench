export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const CHAT_IMAGE_MAX_BYTES = 640 * 1024;
export type ChatImage = { mediaType: typeof CHAT_IMAGE_TYPES[number]; data: string };

export function isChatImage(value: unknown): value is ChatImage {
  if (!value || typeof value !== 'object') return false;
  const { mediaType, data } = value as Partial<ChatImage>;
  return CHAT_IMAGE_TYPES.some(type => type === mediaType) && typeof data === 'string' &&
    data.length > 0 && data.length <= Math.floor(CHAT_IMAGE_MAX_BYTES / 3) * 4 &&
    data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data);
}

export async function encodeChatImage(file: Blob): Promise<ChatImage> {
  if (!CHAT_IMAGE_TYPES.some(type => type === file.type)) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('请选择 20 MB 以内的图片');
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前环境无法处理图片');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.72, 0.58, 0.44]) {
      const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      const result = { mediaType: 'image/jpeg', data } as const;
      if (isChatImage(result)) return result;
    }
    throw new Error('图片过大，请缩小图片后重试');
  } finally { image.close(); }
}

export async function captureChatImage(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  try {
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    if (!video.videoWidth || !video.videoHeight) throw new Error('未能获取截图');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('未能生成截图'));
    }, 'image/jpeg', 0.9));
  } finally {
    video.srcObject = null;
    for (const track of stream.getTracks()) track.stop();
  }
}

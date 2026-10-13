const MAX_BYTES = 400 * 1024;
const MAX_SIDE = 900;

/**
 * Reads a picked image as a data URL. Large photos (e.g. a screenshot of a QR
 * code) are scaled down and re-encoded so they stay under the 400 KB limit
 * while the QR stays sharp enough to scan.
 */
export async function imageForUpload(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  if (file.size <= MAX_BYTES && /^image\/(png|jpeg|webp)$/.test(file.type)) return original;

  const img = await loadImage(original);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

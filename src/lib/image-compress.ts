// ย่อภาพในเครื่องก่อนอัปโหลด (ภาพจากมือถือ 3–10 MB → ราว 100–300 KB) ให้ป๊อปอัปเปิดเร็วบนเน็ตมือถือ
// ใช้ได้เฉพาะในเบราว์เซอร์ (มี canvas)

export type Compressed = { blob: Blob; ext: "webp" | "jpg"; width: number; height: number };

/** ย่อให้กว้างไม่เกิน maxW และสูงไม่เกิน maxH (ไม่ขยายภาพเล็ก) แปลงเป็น WebP ถ้าเบราว์เซอร์รองรับ ไม่งั้น JPEG */
export async function compressImage(file: File, maxW = 1080, maxH = 1920, quality = 0.85): Promise<Compressed> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("เบราว์เซอร์นี้ย่อภาพไม่ได้");
  ctx.fillStyle = "#ffffff"; // ภาพโปร่งใส (PNG) ให้พื้นเป็นสีขาว
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp", width, height };
  const jpg = await toBlob(canvas, "image/jpeg", quality);
  if (!jpg) throw new Error("ย่อภาพไม่สำเร็จ ลองเลือกภาพอื่น");
  return { blob: jpg, ext: "jpg", width, height };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("เปิดภาพนี้ไม่ได้ ใช้ไฟล์ JPG หรือ PNG"));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

// โหมดดูดีไซน์: ใช้ได้เฉพาะ npm run dev เท่านั้น (เว็บจริงปิดเสมอ)
// เปิดด้วย ?preview=employee|supervisor|admin|dept_manager|division_manager|deputy_gm|gm|super_admin  ปิดด้วย ?preview=off
import type { AppRole } from "./types";
import { ROLES } from "./types";

const KEY = "wha-preview-role";

export function previewRole(): AppRole | null {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("preview");
  try {
    if (q === "off") sessionStorage.removeItem(KEY);
    else if (q && (ROLES as string[]).includes(q)) sessionStorage.setItem(KEY, q);
    const v = sessionStorage.getItem(KEY);
    return v && (ROLES as string[]).includes(v) ? (v as AppRole) : null;
  } catch {
    return q && (ROLES as string[]).includes(q) ? (q as AppRole) : null;
  }
}

export type PreviewData = typeof import("./preview-data");

// โหลดข้อมูลสมมติเฉพาะตอนพัฒนา (ตอน build เว็บจริง บรรทัดนี้ถูกตัดทิ้ง ข้อมูลสมมติจึงไม่ติดไปด้วย)
export function loadPreviewData(): Promise<PreviewData> | null {
  return process.env.NODE_ENV === "development" ? import("./preview-data") : null;
}

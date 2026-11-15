// ประชาสัมพันธ์ (ป๊อปอัปเมื่อเปิดแอป): ชนิดข้อมูล การจัดกลุ่มตามวันที่ และการตรวจลิงก์
// ทดสอบได้ด้วย tests/announcements-lib.test.mjs · กฎฝั่งฐานข้อมูลอยู่ใน supabase/migrations/0024_announcements.sql

export type LinkType = "none" | "url" | "menu";

export type Announcement = {
  id: string;
  title: string;
  image_path: string;
  link_type: LinkType;
  link_url: string | null;
  link_menu: string | null;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;
  created_at?: string;
};

/** ประกาศพร้อมลิงก์ภาพที่เปิดดูได้ (ที่เก็บภาพเป็นแบบปิด ต้องขอลิงก์ชั่วคราวก่อน) */
export type AnnouncementView = Announcement & { image_url: string | null };

export const ANN_SELECT = "id, title, image_path, link_type, link_url, link_menu, starts_on, ends_on, created_at";
export const ANN_BUCKET = "announcements";
/** เปิดแอปแล้วเด้งครั้งเดียวต่อการเปิด (ย้ายหน้าในแอปไม่เด้งซ้ำ) */
export const ANN_SESSION_KEY = "wha-announcements-shown";

/** แสดงวันนี้ไหม (นับวันตามเวลาไทย) */
export const isShowing = (a: Pick<Announcement, "starts_on" | "ends_on">, today: string) => a.starts_on <= today && today <= a.ends_on;

/** แบ่งกลุ่มสำหรับหน้าจัดการ: กำลังแสดง / รอแสดง / หมดเวลาแล้ว */
export function groupAnnouncements<T extends Pick<Announcement, "starts_on" | "ends_on">>(list: T[], today: string) {
  const now = list.filter((a) => isShowing(a, today)).sort((a, b) => a.ends_on.localeCompare(b.ends_on));
  const upcoming = list.filter((a) => a.starts_on > today).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const ended = list.filter((a) => a.ends_on < today).sort((a, b) => b.ends_on.localeCompare(a.ends_on));
  return { now, upcoming, ended };
}

/** ลิงก์เว็บที่ยอมรับ: https เท่านั้น ไม่มีช่องว่าง ยาวไม่เกิน 500 (ตรงกับกฎในฐานข้อมูล) */
export function validUrl(raw: string): string | null {
  const u = raw.trim();
  if (u.length > 500 || !/^https:\/\/[^\s]+$/.test(u)) return null;
  try {
    return new URL(u).protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** ชื่อเว็บไซต์สั้นๆ สำหรับแสดงในรายการ เช่น "www.example.com" */
export function urlHost(u: string | null): string {
  if (!u) return "";
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

/** ปลายทางเมนูในแอป: ขึ้นต้นด้วย / ตัวเดียว (กัน //เว็บอื่น ที่เบราว์เซอร์ตีความเป็นลิงก์ออกนอกแอป) */
export const validMenuPath = (p: string | null | undefined) => !!p && /^\/(?!\/)[a-z0-9/_-]*$/.test(p);

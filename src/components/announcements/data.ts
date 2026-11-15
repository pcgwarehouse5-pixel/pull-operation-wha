"use client";

// โหลดประชาสัมพันธ์ + ขอลิงก์ภาพชั่วคราว (ที่เก็บภาพเป็นแบบปิด เห็นเฉพาะคนที่ล็อกอิน)
import { sb } from "@/lib/supabase";
import { ANN_BUCKET, ANN_SELECT, type Announcement, type AnnouncementView } from "@/lib/announcements";

/** ลิงก์ภาพใช้ได้ 1 ชั่วโมง (ขอใหม่ทุกครั้งที่เปิดแอป) */
export async function withImageUrls(list: Announcement[]): Promise<AnnouncementView[]> {
  if (!list.length) return [];
  const { data } = await sb().storage.from(ANN_BUCKET).createSignedUrls([...new Set(list.map((a) => a.image_path))], 3600);
  const urls = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return list.map((a) => ({ ...a, image_url: urls.get(a.image_path) ?? null }));
}

/** ประกาศที่แสดงวันนี้ (ใช้ในป๊อปอัป) */
export async function loadShowingToday(today: string): Promise<AnnouncementView[]> {
  const { data, error } = await sb()
    .from("announcements")
    .select(ANN_SELECT)
    .is("deleted_at", null)
    .lte("starts_on", today)
    .gte("ends_on", today)
    .order("starts_on", { ascending: false })
    .limit(10);
  if (error) throw error;
  return withImageUrls((data ?? []) as Announcement[]);
}

/** ทุกประกาศที่ยังไม่ลบ (หน้าจัดการ · หัวหน้างานขึ้นไป) */
export async function loadAll(): Promise<AnnouncementView[]> {
  const { data, error } = await sb().from("announcements").select(ANN_SELECT).is("deleted_at", null).order("starts_on", { ascending: false }).limit(200);
  if (error) throw error;
  return withImageUrls((data ?? []) as Announcement[]);
}

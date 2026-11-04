import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// สร้างตอนใช้งานจริงเท่านั้น (ตอน build ยังไม่มีค่า Environment Variables ก็ไม่พัง)
export function sb(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

// ผู้ใช้ล็อกอินด้วย "รหัสพนักงาน" ระบบแปลงเป็นอีเมลภายใน (ไม่มีการส่งอีเมลจริง)
export const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local";

export function codeToEmail(code: string): string {
  const c = code.trim().toLowerCase();
  return c.includes("@") ? c : `${c}@${LOGIN_DOMAIN}`;
}

// Supabase ส่งข้อมูลให้ครั้งละไม่เกิน 1,000 แถว ฟังก์ชันนี้ดึงทีละหน้าจนครบ
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

// แปลง error เป็นข้อความภาษาไทยที่อ่านเข้าใจ
export function errText(e: unknown): string {
  const msg = (e as { message?: string })?.message || String(e);
  if (/Invalid login credentials/i.test(msg)) return "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง";
  if (/row-level security|permission denied/i.test(msg)) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  if (/duplicate key/i.test(msg)) return "ข้อมูลนี้มีอยู่แล้ว";
  return msg;
}

// เรียก API ฝั่งเซิร์ฟเวอร์ของแอปพร้อมยืนยันตัวตน
export async function api<T = { ok: true }>(path: string, method: string, body: unknown): Promise<T> {
  const { data } = await sb().auth.getSession();
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "ทำรายการไม่สำเร็จ ลองอีกครั้ง");
  return json as T;
}

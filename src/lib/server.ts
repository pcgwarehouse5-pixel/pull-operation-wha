// ใช้ในไฟล์ src/app/api/** (ฝั่งเซิร์ฟเวอร์) เท่านั้น ห้าม import ในหน้าจอ
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า ${name}`);
  return v;
}

// สิทธิ์ระดับระบบ (ข้าม RLS) ใช้เฉพาะงานที่ตรวจสิทธิ์แล้ว
export function adminClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ทำงานในนามผู้ใช้ที่เรียก (RLS และฟังก์ชันตรวจสิทธิ์ทำงานตามปกติ)
export function userClient(token: string): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function defaultPassword(): string {
  const p = env("DEFAULT_USER_PASSWORD");
  if (p.length < 6) throw new Error("DEFAULT_USER_PASSWORD ต้องยาวอย่างน้อย 6 ตัว");
  return p;
}

// ตรวจว่าผู้เรียกล็อกอินอยู่และยังใช้งานได้
export async function getCaller(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const admin = adminClient();
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return null;
  const { data: me } = await admin
    .from("profiles")
    .select("id, employee_code, role, status, warehouse_id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!me || me.status !== "active") return null;
  return { admin, token, me: me as { id: string; employee_code: string; role: string; warehouse_id: string | null } };
}

export async function writeAudit(admin: SupabaseClient, row: { actor_id: string; action: string; record_id: string; warehouse_id: string | null; new_data?: unknown }) {
  await admin.from("audit_logs").insert({ ...row, table_name: "profiles" });
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

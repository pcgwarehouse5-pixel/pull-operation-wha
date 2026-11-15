// ทดสอบประชาสัมพันธ์กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create)
// ใช้: node scripts/e2e-announcements.mjs
// ตั้งวันแสดงเป็น "พรุ่งนี้" จึงไม่เด้งให้พนักงานจริงเห็น และลบประกาศ/ภาพทดสอบทิ้งเมื่อจบ
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
process.loadEnvFile(".env.e2e.local");
const e = process.env;
const domain = e.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local";
const service = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ผ่าน" : "ไม่ผ่าน"}: ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) failed++;
};
async function login(code) {
  const c = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: `${code}@${domain}`, password: e[`E2E_${code.replace(/-/g, "_").toUpperCase()}`] });
  if (error) throw new Error(`${code}: ${error.message}`);
  return { c, id: data.user.id };
}

const sup = await login("ztest-sup");
const emp = await login("ztest-emp2");
const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(Date.now() + 86400000));
// ภาพ PNG 1×1 จุด (ทดสอบการอัปโหลด)
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const path = `${crypto.randomUUID()}.png`;
let annId = null;

try {
  let r = await emp.c.storage.from("announcements").upload(`${crypto.randomUUID()}.png`, png, { contentType: "image/png" });
  check("พนักงานอัปโหลดภาพประกาศไม่ได้", !!r.error);
  r = await sup.c.storage.from("announcements").upload("bad-name.png", png, { contentType: "image/png" });
  check("ชื่อไฟล์ผิดรูปแบบอัปโหลดไม่ได้", !!r.error);
  r = await sup.c.storage.from("announcements").upload(path, png, { contentType: "image/png" });
  check("หัวหน้างานอัปโหลดภาพได้", !r.error, r.error?.message);

  r = await emp.c.rpc("save_announcement", { p_id: null, p_title: "ทดสอบ", p_image_path: path, p_link_type: "none", p_link_url: null, p_link_menu: null, p_starts: tomorrow, p_ends: tomorrow });
  check("พนักงานเพิ่มประกาศไม่ได้", !!r.error);
  r = await sup.c.rpc("save_announcement", {
    p_id: null, p_title: "ZTEST ประกาศทดสอบ (ลบได้)", p_image_path: path, p_link_type: "menu", p_link_url: null, p_link_menu: "/my-position", p_starts: tomorrow, p_ends: tomorrow,
  });
  annId = r.data;
  check("หัวหน้างานเพิ่มประกาศได้", !r.error && !!annId, r.error?.message);

  const supSees = await sup.c.from("announcements").select("id").eq("id", annId);
  check("หัวหน้างานเห็นประกาศที่ยังไม่ถึงวัน (เพื่อจัดการ)", supSees.data?.length === 1);
  const empSees = await emp.c.from("announcements").select("id").eq("id", annId);
  check("พนักงานยังไม่เห็นประกาศที่ยังไม่ถึงวันแสดง", (empSees.data ?? []).length === 0);

  const signed = await emp.c.storage.from("announcements").createSignedUrls([path], 60);
  const url = signed.data?.[0]?.signedUrl;
  check("พนักงานขอลิงก์ภาพได้ (ที่เก็บแบบปิด เฉพาะคนล็อกอิน)", !!url, signed.error?.message);
  if (url) {
    const res = await fetch(url);
    check("เปิดภาพจากลิงก์ชั่วคราวได้", res.ok && (res.headers.get("content-type") ?? "").startsWith("image/"), String(res.status));
  }
  const anon = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const anonSigned = await anon.storage.from("announcements").createSignedUrls([path], 60);
  check("คนที่ไม่ล็อกอินขอลิงก์ภาพไม่ได้", !anonSigned.data?.[0]?.signedUrl);

  r = await sup.c.storage.from("announcements").remove([path]);
  const still = await sup.c.storage.from("announcements").createSignedUrls([path], 60);
  check("ลบภาพที่ประกาศยังใช้อยู่ไม่ได้", !!still.data?.[0]?.signedUrl);

  r = await emp.c.rpc("delete_announcement", { p_id: annId });
  check("พนักงานลบประกาศไม่ได้", !!r.error);
  r = await sup.c.rpc("delete_announcement", { p_id: annId });
  check("หัวหน้างานลบประกาศได้ (เก็บประวัติ)", !r.error, r.error?.message);
  const kept = await service.from("announcements").select("deleted_at, deleted_by").eq("id", annId).single();
  check("ลบแบบเก็บประวัติ (มีวันที่ลบและคนลบ)", !!kept.data?.deleted_at && kept.data.deleted_by === sup.id);
} finally {
  if (annId) await service.from("announcements").delete().eq("id", annId);
  await service.storage.from("announcements").remove([path]);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

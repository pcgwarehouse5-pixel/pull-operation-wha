// ทดสอบลงเวลา + ใบลา กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create + passwords)
// ใช้: node scripts/e2e-attendance.mjs   (แตะเฉพาะคลัง ZZTEST ซึ่งตั้งพิกัดสมมติ 13.0, 100.0 รัศมี 100 ม.)
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
process.loadEnvFile(".env.e2e.local");
const e = process.env;
const domain = e.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local";
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
const adm = await login("ztest-admin");
const { data: wh } = await sup.c.from("warehouses").select("id").eq("code", "ZZTEST").single();

// ---------- ลงเวลา ----------
let r = await emp.c.rpc("punch", { p_kind: "in", p_lat: 13.01, p_lng: 100.0, p_accuracy: 10 });
check("กดเข้างานนอกรัศมีคลัง ถูกปฏิเสธ", !!r.error && /นอกพื้นที่/.test(r.error.message), r.error?.message);
r = await emp.c.rpc("punch", { p_kind: "in", p_lat: 13.0, p_lng: 100.0, p_accuracy: 500 });
check("GPS ไม่แม่น ถูกปฏิเสธ", !!r.error && /GPS/.test(r.error.message));
r = await emp.c.rpc("punch", { p_kind: "in", p_lat: 13.0003, p_lng: 100.0, p_accuracy: 10 });
check("กดเข้างานในรัศมี", !r.error && r.data?.kind === "in", r.error?.message ?? `ห่าง ${r.data?.distance_m} ม.`);
r = await emp.c.rpc("punch", { p_kind: "in", p_lat: 13.0, p_lng: 100.0, p_accuracy: 10 });
check("กดเข้างานซ้ำ ถูกปฏิเสธ", !!r.error);
r = await emp.c.from("attendance_punches").insert({ user_id: emp.id, kind: "out", work_date: "2026-12-01" });
check("เขียนเวลาตรงเข้าตาราง ไม่ได้", !!r.error);
r = await emp.c.rpc("punch", { p_kind: "out", p_lat: 13.0, p_lng: 100.0, p_accuracy: 10 });
check("กดออกงาน", !r.error && r.data?.kind === "out", r.error?.message);
const today = r.data?.work_date;
let s = await emp.c.rpc("my_attendance", { p_from: today, p_to: today });
check("ดูเวลาของตัวเอง", (s.data ?? []).length === 1 && !!s.data[0].first_in && !!s.data[0].last_out, s.error?.message ?? s.data?.[0]?.status);
s = await sup.c.rpc("warehouse_attendance", { p_wh: wh.id, p_from: today, p_to: today });
check("หัวหน้าดูการเข้างานของคลัง", (s.data ?? []).some((x) => x.user_id === emp.id && x.first_in), s.error?.message);
s = await emp.c.rpc("warehouse_attendance", { p_wh: wh.id, p_from: today, p_to: today });
check("พนักงานดูการเข้างานทั้งคลังไม่ได้", !!s.error);

// ---------- ขอแก้เวลา ----------
const y = new Date(Date.parse(`${today}T12:00:00+07:00`) - 86400000).toISOString().slice(0, 10);
r = await emp.c.rpc("request_correction", { p_date: y, p_in: "08:00", p_out: "17:00", p_reason: "ทดสอบระบบ" });
check("ขอแก้เวลา", !r.error, r.error?.message);
const cid = r.data;
r = await emp.c.rpc("decide_correction", { p_id: cid, p_approve: true });
check("อนุมัติคำขอของตัวเองไม่ได้", !!r.error);
r = await sup.c.rpc("decide_correction", { p_id: cid, p_approve: true, p_note: "ทดสอบ" });
check("หัวหน้าอนุมัติแก้เวลา", !r.error, r.error?.message);
s = await emp.c.from("attendance_punches").select("kind").eq("work_date", y);
check("อนุมัติแล้วมีเวลาเข้า-ออกของวันนั้น", (s.data ?? []).length === 2);

// ---------- ใบลา ----------
const d1 = "2027-03-01";
let b = await emp.c.rpc("leave_balance", { p_year: 2027 });
check("ดูวันลาคงเหลือ", !b.error && (b.data ?? []).length > 0, b.error?.message);
const types = (b.data ?? []).map((x) => x.leave_type);
const sick = types.includes("sick") ? "sick" : types[0];
const vac = types.includes("vacation") ? "vacation" : types[0];

// ไฟล์แนบ (PDF เล็กๆ ปลอม) ในโฟลเดอร์ของตัวเอง
const path = `${emp.id}/e2e-test.pdf`;
const up = await emp.c.storage.from("leave-attachments").upload(path, new Blob(["%PDF-1.4\n%e2e\n"], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
check("อัปโหลดไฟล์แนบในโฟลเดอร์ตัวเอง", !up.error, up.error?.message);
const bad = await emp.c.storage.from("leave-attachments").upload(`${sup.id}/x.pdf`, new Blob(["%PDF"], { type: "application/pdf" }), { contentType: "application/pdf" });
check("อัปโหลดไฟล์เข้าโฟลเดอร์คนอื่นไม่ได้", !!bad.error);

r = await emp.c.rpc("submit_leave", { p_type: sick, p_start: d1, p_end: d1, p_period: "full", p_reason: "ทดสอบ", p_attachment: sick === "sick" ? path : null });
check("ยื่นใบลาป่วย (แนบไฟล์)", !r.error, r.error?.message);
const l1 = r.data;
const signed = await sup.c.storage.from("leave-attachments").createSignedUrl(path, 60);
check("หัวหน้าเปิดไฟล์แนบได้", !signed.error, signed.error?.message);
const other = await adm.c.storage.from("leave-attachments").createSignedUrl(path, 60);
check("แอดมินคลังเดียวกันเปิดไฟล์แนบได้", !other.error, other.error?.message);
r = await emp.c.rpc("decide_leave", { p_id: l1, p_approve: true });
check("อนุมัติใบลาตัวเองไม่ได้", !!r.error);
r = await sup.c.rpc("decide_leave", { p_id: l1, p_approve: true, p_note: "หายไวๆ" });
check("หัวหน้าอนุมัติใบลา 1 วัน", r.data === "approved", r.error?.message ?? r.data);

r = await emp.c.rpc("submit_leave", { p_type: vac, p_start: "2027-03-10", p_end: "2027-03-15", p_period: "full", p_reason: "ทดสอบ" });
const l2 = r.data;
check("ยื่นใบลาหลายวัน", !r.error, r.error?.message);
const row = await emp.c.from("leave_requests").select("steps_required, days").eq("id", l2).single();
r = await sup.c.rpc("decide_leave", { p_id: l2, p_approve: true });
check(
  "ลาตั้งแต่ 4 วัน: หัวหน้าอนุมัติแล้วยังรอผู้บริหาร",
  row.data?.steps_required === 2 ? r.data === "pending" : r.data === "approved",
  `${row.data?.days} วัน, ${row.data?.steps_required} ขั้น → ${r.data ?? r.error?.message}`,
);
r = await emp.c.rpc("cancel_leave", { p_id: l2, p_reason: "ทดสอบยกเลิก" });
check("ยกเลิกใบลาที่ยังไม่อนุมัติครบ", r.data === "cancelled", r.error?.message ?? r.data);

// ---------- เก็บกวาด (ใบลา/เวลาถูกลบพร้อมบัญชีใน e2e-temp delete) ----------
console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

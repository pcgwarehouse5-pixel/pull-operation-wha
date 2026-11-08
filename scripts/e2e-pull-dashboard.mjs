// ทดสอบ Dashboard ผู้บริหาร + เวลาพัก กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create + passwords)
// ใช้: node scripts/e2e-pull-dashboard.mjs   (จองเฉพาะคนในคลังทดสอบ ZZTEST แล้วลบทิ้งเมื่อจบ)
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

const adm = await login("ztest-admin");
const sup = await login("ztest-sup");
const emp = await login("ztest-emp2");
const { data: wh } = await service.from("warehouses").select("id").eq("code", "ZZTEST").single();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const from = new Date(Date.parse(today + "T00:00:00Z") - 6 * 86400000).toISOString().slice(0, 10);
const SKILL = "RT รับ(Domestics)";

try {
  const { data: sk } = await service.from("skills").select("id").eq("name", SKILL).limit(1).single();
  await service.from("employee_skills").insert({ user_id: emp.id, skill_id: sk.id });
  await service.from("shift_schedules").insert({ user_id: emp.id, work_date: today, shift_code: "STD1" });
  await adm.c.rpc("set_pull_skills", { p_wh: wh.id, p_skills: [SKILL] });
  await sup.c.rpc("book_pull", { p_to_wh: wh.id, p_date: today, p_shift: "morning", p_items: [{ user_id: emp.id, skill: SKILL }] });

  let r = await adm.c.rpc("pull_network", { p_from: from, p_to: today, p_shift: "morning" });
  const mine = (r.data ?? []).filter((x) => x.wh_id === wh.id);
  const t = mine.find((x) => x.work_day === today);
  check("แอดมินดูภาพรวมทุกคลังได้ 7 วัน", !r.error && mine.length === 7, r.error?.message ?? `${r.data?.length} แถว`);
  check("ภาพรวมเห็นคลังจริงด้วย (ตัวเลขรวม)", (r.data ?? []).some((x) => x.wh_code === "WH5"));
  check("คลังทดสอบ: กำลังคน 1 จองแล้ว 1 ความต้องการ — (ยังไม่ผูกงาน)", t && t.pool_count === 1 && t.booked === 1 && t.need === null && t.complete === false, JSON.stringify(t));
  check("ภาพรวมไม่มีรายชื่อพนักงาน", t && !("name" in t) && !("employee_code" in t));
  r = await sup.c.rpc("pull_network", { p_from: from, p_to: today, p_shift: "morning" });
  check("หัวหน้างานดู Dashboard ผู้บริหารไม่ได้", !!r.error);
  r = await adm.c.rpc("pull_network", { p_from: "2026-01-01", p_to: today, p_shift: "all" });
  check("ช่วงวันที่เกิน 31 วันไม่ได้", !!r.error);

  const { data: b } = await sup.c.from("pull_bookings").select("id").eq("user_id", emp.id).eq("status", "booked").single();
  r = await sup.c.rpc("set_pull_break", { p_id: b.id, p_time: "12:00" });
  check("หัวหน้างานตั้งเวลาพัก", !r.error, r.error?.message);
  const after = await emp.c.from("pull_bookings").select("break_time").eq("id", b.id).single();
  check("พนักงานเห็นเวลาพักของตัวเอง", after.data?.break_time === "12:00:00", after.data?.break_time);
  r = await emp.c.rpc("set_pull_break", { p_id: b.id, p_time: "13:00" });
  check("พนักงานตั้งเวลาพักเองไม่ได้", !!r.error);
  r = await sup.c.rpc("set_pull_break", { p_id: b.id, p_time: "99:00" });
  check("เวลาพักผิดรูปแบบไม่ได้", !!r.error);
  r = await sup.c.rpc("pull_requirements", { p_wh: wh.id, p_date: today, p_shift: "morning" });
  check("ผลคำนวณเดิมยังใช้ได้หลังแยกฟังก์ชันแกน", !r.error && (r.data ?? []).length === 1 && r.data[0].missing === "ยังไม่ผูกประเภทงาน", r.error?.message ?? JSON.stringify(r.data));
  r = await sup.c.rpc("pull_requirements_core", { p_wh: wh.id, p_date: today, p_shift: "morning" });
  check("ฟังก์ชันแกนเรียกจากหน้าเว็บไม่ได้", !!r.error);
} finally {
  await service.from("pull_bookings").delete().eq("to_warehouse_id", wh.id);
  await service.from("pull_skills").delete().eq("warehouse_id", wh.id);
  await service.from("shift_schedules").delete().eq("user_id", emp.id);
  await service.from("employee_skills").delete().eq("user_id", emp.id);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

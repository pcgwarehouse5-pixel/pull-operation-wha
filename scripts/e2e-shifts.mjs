// ทดสอบตารางกะกับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create + passwords)
// ใช้: node scripts/e2e-shifts.mjs   (แตะเฉพาะคลัง ZZTEST แล้วลบตารางกะที่สร้างทิ้งเมื่อจบ)
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
const month = "2026-12-01";
const cells = [
  { user_id: emp.id, work_date: "2026-12-01", shift_code: "STD1" },
  { user_id: emp.id, work_date: "2026-12-02", shift_code: "GN_5", holiday_work: "OFF" },
  { user_id: sup.id, work_date: "2026-12-01", shift_code: "OFF" },
];

let r = await sup.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: cells, p_source: "e2e" });
check("หัวหน้างานบันทึกหลายช่อง", !r.error && r.data === 3, r.error?.message ?? `${r.data} ช่อง`);
r = await emp.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: cells, p_source: "e2e" });
check("พนักงานบันทึกไม่ได้", !!r.error);
r = await emp.c.from("shift_schedules").insert({ user_id: emp.id, work_date: "2026-12-05", shift_code: "STD1" });
check("พนักงานเขียนตรงเข้าตารางไม่ได้", !!r.error);

let s = await emp.c.from("shift_schedules").select("work_date").gte("work_date", month);
check("ร่าง: พนักงานยังไม่เห็น", (s.data ?? []).length === 0);
s = await sup.c.from("shift_schedules").select("user_id").lt("work_date", "2026-12-01").limit(5);
check("หัวหน้างานไม่เห็นกะของคลังอื่น (ข้อมูลเดิม ต.ค./พ.ย.)", (s.data ?? []).length === 0);

r = await sup.c.rpc("set_schedule_status", { p_wh: wh.id, p_month: month, p_status: "published" });
check("ประกาศตารางกะ", !r.error, r.error?.message);
s = await emp.c.from("shift_schedules").select("user_id, work_date, shift_code").gte("work_date", month);
check("ประกาศแล้ว: พนักงานเห็นของตัวเองและเพื่อนร่วมคลัง", (s.data ?? []).length === 3);
const t = await emp.c.rpc("team_schedule", { p_month: month });
check("รายชื่อเพื่อนร่วมคลัง", (t.data ?? []).length === 3 && !("phone" in (t.data?.[0] ?? {})), t.error?.message);
s = await emp.c.from("shift_schedules").select("user_id").lt("work_date", month).limit(5);
check("พนักงานไม่เห็นข้อมูลคลังอื่น", (s.data ?? []).length === 0);

const h = await sup.c.rpc("schedule_history", { p_wh: wh.id, p_month: month });
check("ประวัติการบันทึก", (h.data ?? []).length === 1 && h.data[0].source === "e2e", h.error?.message);
r = await sup.c.rpc("undo_shift_bulk", { p_audit_id: h.data?.[0]?.id });
check("ย้อนกลับการบันทึก", r.data === 3, r.error?.message ?? `${r.data}`);
s = await sup.c.from("shift_schedules").select("user_id").gte("work_date", month);
check("ย้อนกลับแล้วตารางว่าง", (s.data ?? []).length === 0);

await sup.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: cells, p_source: "e2e" });
r = await adm.c.rpc("clear_schedule_month", { p_wh: wh.id, p_month: month, p_reason: "ทดสอบระบบ" });
check("แอดมินล้างทั้งเดือน", r.data === 3, r.error?.message);
const h2 = await adm.c.rpc("schedule_history", { p_wh: wh.id, p_month: month });
const clr = (h2.data ?? []).find((x) => x.action === "schedule_clear");
r = await adm.c.rpc("restore_schedule_month", { p_audit_id: clr?.id });
check("คืนข้อมูลที่ล้าง", r.data === 3, r.error?.message);

// เก็บกวาด: ล้างตารางกะ ธ.ค. ของคลังทดสอบ (บัญชี/คลังลบด้วย e2e-temp.mjs delete)
await adm.c.rpc("clear_schedule_month", { p_wh: wh.id, p_month: month, p_reason: "เก็บกวาดหลังทดสอบ" });
console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

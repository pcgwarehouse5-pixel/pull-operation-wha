// ทดสอบตารางกะหัวหน้าคลังกับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create)
// ใช้: node scripts/e2e-lead-schedule.mjs   (แตะเฉพาะคลัง ZZTEST แล้วลบตารางกะ/สถานะที่สร้างทิ้งเมื่อจบ)
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

const dm = await login("ztest-dm");
const sup = await login("ztest-sup");
const adm = await login("ztest-admin");
const lead = await login("ztest-lead");
const emp = await login("ztest-emp2");
const { data: wh } = await sup.c.from("warehouses").select("id").eq("code", "ZZTEST").single();
const month = "2026-12-01";
const cell = (u, code = "STD1") => ({ user_id: u, work_date: month, shift_code: code });
const seen = async (who) => ((await who.c.from("shift_schedules").select("user_id").eq("work_date", month)).data ?? []).map((x) => x.user_id);

try {
  let r = await sup.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: [cell(lead.id)], p_source: "e2e" });
  check("หัวหน้างานแก้กะหัวหน้าคลังไม่ได้", !!r.error, r.error?.message);
  r = await adm.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: [cell(lead.id)], p_source: "e2e" });
  check("แอดมินแก้กะหัวหน้าคลังไม่ได้", !!r.error);
  r = await sup.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: [cell(emp.id)], p_source: "e2e" });
  check("หัวหน้างานแก้ตารางกะปกติได้ตามเดิม", !r.error && r.data === 1, r.error?.message);
  r = await dm.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: [cell(lead.id), cell(dm.id)], p_source: "e2e" });
  check("ผู้จัดการแผนกแก้กะหัวหน้าคลังได้", !r.error && r.data === 2, r.error?.message);

  check("แอดมินเห็นทุกคน (ดูอย่างเดียว) แม้ยังเป็นร่าง", (await seen(adm)).length === 3);
  r = await adm.c.rpc("set_schedule_status_scope", { p_wh: wh.id, p_month: month, p_status: "published", p_scope: "lead" });
  check("แอดมินประกาศตารางหัวหน้าคลังไม่ได้", !!r.error);
  r = await sup.c.rpc("set_schedule_status", { p_wh: wh.id, p_month: month, p_status: "published" });
  check("หัวหน้างานประกาศตารางปกติได้", !r.error, r.error?.message);
  check("พนักงานเห็นเฉพาะตารางปกติ", JSON.stringify(await seen(emp)) === JSON.stringify([emp.id]));
  check("หัวหน้าคลังยังไม่เห็นกะตัวเอง (ตารางหัวหน้าคลังยังเป็นร่าง)", !(await seen(lead)).includes(lead.id));
  r = await dm.c.rpc("set_schedule_status_scope", { p_wh: wh.id, p_month: month, p_status: "published", p_scope: "lead" });
  check("ผู้จัดการประกาศตารางหัวหน้าคลังได้", !r.error, r.error?.message);
  check("หัวหน้าคลังเห็นกะตัวเองแล้ว", (await seen(lead)).includes(lead.id));
  check("พนักงานยังไม่เห็นกะหัวหน้าคลัง", !(await seen(emp)).includes(lead.id));
  const t = await emp.c.rpc("team_schedule", { p_month: month });
  check("ตารางเพื่อนร่วมคลังของพนักงานไม่มีหัวหน้าคลัง", !t.error && !(t.data ?? []).some((x) => x.user_id === lead.id), t.error?.message);
  const n = await lead.c.from("notifications").select("title").ilike("title", "%หัวหน้าคลัง%");
  check("หัวหน้าคลังได้แจ้งเตือนประกาศตารางหัวหน้าคลัง", (n.data ?? []).length === 1);
  const n2 = await emp.c.from("notifications").select("title").ilike("title", "%หัวหน้าคลัง%");
  check("พนักงานไม่ได้แจ้งเตือนตารางหัวหน้าคลัง", (n2.data ?? []).length === 0);
} finally {
  // เก็บกวาด (เฉพาะคลัง ZZTEST)
  await dm.c.rpc("clear_schedule_scope", { p_wh: wh.id, p_month: month, p_reason: "ล้างหลังทดสอบ", p_scope: "lead" });
  await sup.c.rpc("clear_schedule_month", { p_wh: wh.id, p_month: month, p_reason: "ล้างหลังทดสอบ" });
  await dm.c.rpc("set_schedule_status_scope", { p_wh: wh.id, p_month: month, p_status: "draft", p_scope: "lead" });
  await sup.c.rpc("set_schedule_status", { p_wh: wh.id, p_month: month, p_status: "draft" });
}
console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

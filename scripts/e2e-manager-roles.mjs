// ทดสอบบทบาทผู้จัดการและลำดับอนุมัติกับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create)
// ใช้: node scripts/e2e-manager-roles.mjs   (ยื่นใบลาเฉพาะบัญชีทดสอบ ztest- · ลบทิ้งด้วย e2e-temp.mjs delete)
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
const emp = await login("ztest-emp2");

const { data: whs } = await dm.c.from("warehouses").select("code");
check("ผู้จัดการแผนกเห็นทุกคลัง", (whs ?? []).length >= 3, `${whs?.length} คลัง`);
const { data: types } = await sup.c.from("dropdown_options").select("value").eq("category", "leave_type").eq("is_active", true).limit(1);
const lt = types?.[0]?.value;

let r = await sup.c.rpc("submit_leave", { p_type: lt, p_start: "2026-12-21", p_end: "2026-12-21", p_period: "full", p_reason: "ทดสอบลำดับอนุมัติ" });
check("หัวหน้างานยื่นใบลา", !r.error, r.error?.message);
const lid = r.data;
let n = await dm.c.from("notifications").select("kind").eq("kind", "leave_pending");
check("ผู้จัดการแผนกได้แจ้งเตือน", (n.data ?? []).length >= 1);
r = await adm.c.rpc("decide_leave", { p_id: lid, p_approve: true, p_note: null });
check("แอดมินอนุมัติใบลาหัวหน้างานไม่ได้", !!r.error, r.error?.message);
r = await dm.c.rpc("decide_leave", { p_id: lid, p_approve: true, p_note: null });
check("ผู้จัดการแผนกอนุมัติได้", !r.error && r.data === "approved", r.error?.message ?? r.data);

r = await emp.c.rpc("submit_leave", { p_type: lt, p_start: "2026-12-22", p_end: "2026-12-22", p_period: "full", p_reason: "ทดสอบ" });
const l2 = r.data;
n = await dm.c.from("notifications").select("kind").eq("kind", "leave_pending");
check("ใบลาพนักงานไม่แจ้งผู้จัดการ (แจ้งหัวหน้างาน/แอดมิน)", (n.data ?? []).length === 1);
r = await sup.c.rpc("decide_leave", { p_id: l2, p_approve: true, p_note: null });
check("หัวหน้างานอนุมัติใบลาพนักงานได้", !r.error && r.data === "approved", r.error?.message ?? r.data);

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

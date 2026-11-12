// ทดสอบ "หัวหน้างานทำงานได้เท่าแอดมินคลัง" กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create)
// ใช้: node scripts/e2e-supervisor-admin.mjs   (แตะเฉพาะคลัง ZZTEST และบัญชี ztest แล้วคืนค่าที่แก้เมื่อจบ)
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
const lead = await login("ztest-lead");
const { data: wh } = await service.from("warehouses").select("id").eq("code", "ZZTEST").single();
const { data: wh5 } = await service.from("warehouses").select("id").eq("code", "WH5").single();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

// หัวหน้าคลังตัวจริงทุกคนเป็นบทบาทหัวหน้างานแล้ว (migration 0020) ทำบัญชีทดสอบให้เหมือนกัน
await service.from("profiles").update({ role: "supervisor" }).eq("id", lead.id);

try {
  // ทำได้เหมือนแอดมิน (คลังตัวเอง)
  let r = await sup.c.from("profiles").update({ position: "RT" }).eq("id", emp.id).select("id");
  check("แก้ข้อมูลพนักงานในคลังตัวเองได้", !r.error && r.data?.length === 1, r.error?.message);
  r = await sup.c.rpc("can_manage_user", { p_user: emp.id });
  check("รีเซ็ตรหัสผ่านพนักงานในคลังได้ (can_manage_user)", r.data === true, r.error?.message);
  r = await sup.c.rpc("set_user_access", { p_user: emp.id, p_role: "supervisor", p_home: wh.id, p_extra: [] });
  check("ตั้งพนักงานเป็นหัวหน้างานได้", !r.error, r.error?.message);
  await service.from("profiles").update({ role: "employee" }).eq("id", emp.id);
  r = await sup.c.rpc("set_user_access", { p_user: emp.id, p_role: "admin", p_home: wh.id, p_extra: [] });
  check("ตั้งเป็นแอดมินไม่ได้ (เกินระดับ)", !!r.error);
  r = await sup.c.from("headcount_budgets").insert({ warehouse_id: wh.id, position: "RT", budget_count: 3 }).select("id");
  check("แก้อัตรากำลังคลังตัวเองได้", !r.error, r.error?.message);
  r = await sup.c.from("headcount_budgets").insert({ warehouse_id: wh5.id, position: "ZTEST", budget_count: 1 }).select("id");
  check("แก้อัตรากำลังคลังอื่นไม่ได้", !!r.error || (r.data ?? []).length === 0);
  r = await sup.c.rpc("pull_network", { p_from: today, p_to: today, p_shift: "morning" });
  check("เปิด Dashboard ผู้บริหารได้", !r.error, r.error?.message);
  r = await sup.c.from("audit_logs").select("id").eq("warehouse_id", wh.id).limit(1);
  check("ดูประวัติการใช้งานของคลังได้", !r.error && (r.data ?? []).length > 0, r.error?.message);

  // ยังทำไม่ได้ (ตามที่ตกลง)
  r = await sup.c.rpc("set_pull_skills", { p_wh: wh.id, p_skills: [] });
  check("ตั้งค่า Pull ไม่ได้", !!r.error && /ไม่มีสิทธิ์/.test(r.error.message), r.error?.message);
  r = await sup.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: [{ user_id: lead.id, work_date: today, shift_code: "STD1" }], p_source: "e2e" });
  check("แก้ตารางกะหัวหน้าคลังไม่ได้", !!r.error, r.error?.message);
  r = await sup.c.rpc("can_approve_user", { p_user: lead.id });
  check("อนุมัติคำขอของหัวหน้าคลังด้วยกันไม่ได้ (ลำดับอนุมัติเดิม)", r.data === false, r.error?.message);
  r = await sup.c.rpc("can_approve_user", { p_user: emp.id });
  check("อนุมัติคำขอของพนักงานในคลังได้เหมือนเดิม", r.data === true, r.error?.message);
  r = await sup.c.from("app_settings").insert({ key: "ztest.x", effective_from: today, value: "1" }).select("key");
  check("แก้อัตรา/กฎในตั้งค่า (เฉพาะผู้จัดการ) ไม่ได้", !!r.error || (r.data ?? []).length === 0);
  r = await sup.c.from("warehouses").update({ checkin_radius_m: 999 }).eq("id", wh.id).select("id");
  check("แก้คลัง/รัศมีลงเวลา (เฉพาะผู้จัดการ) ไม่ได้", !!r.error || (r.data ?? []).length === 0);
  // พนักงานยังทำไม่ได้
  r = await emp.c.from("headcount_budgets").insert({ warehouse_id: wh.id, position: "OP", budget_count: 1 }).select("id");
  check("พนักงานแก้อัตรากำลังไม่ได้", !!r.error || (r.data ?? []).length === 0);
} finally {
  await service.from("headcount_budgets").delete().eq("warehouse_id", wh.id);
  await service.from("headcount_budgets").delete().eq("position", "ZTEST");
  await service.from("app_settings").delete().eq("key", "ztest.x");
  await service.from("profiles").update({ role: "employee", position: null }).eq("id", emp.id);
  await service.from("profiles").update({ role: "employee" }).eq("id", lead.id);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

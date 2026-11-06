// ทดสอบ OT / รายงาน / แจ้งเตือน กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create + passwords)
// ใช้: node scripts/e2e-ot.mjs   (แตะเฉพาะคลัง ZZTEST)
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
const bkk = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
const y = bkk(new Date(Date.now() - 86400000));
const month = `${y.slice(0, 7)}-01`;

// กะ STD1 (08:00–17:00) ของเมื่อวาน + แก้เวลาเป็น 08:00–19:10 → OT 2 ชม. × 1.5
let r = await sup.c.rpc("apply_shifts", { p_wh: wh.id, p_rows: [{ user_id: emp.id, work_date: y, shift_code: "STD1" }], p_source: "e2e" });
check("หัวหน้าใส่กะเมื่อวาน", !r.error, r.error?.message);
r = await emp.c.rpc("request_correction", { p_date: y, p_in: "08:00", p_out: "19:10", p_reason: "ทดสอบ OT" });
check("พนักงานขอแก้เวลา", !r.error, r.error?.message);
const cid = r.data;
let n = await sup.c.from("notifications").select("kind").eq("kind", "correction_pending");
check("หัวหน้าได้แจ้งเตือนคำขอแก้เวลา", (n.data ?? []).length >= 1);
r = await sup.c.rpc("decide_correction", { p_id: cid, p_approve: true, p_note: "ทดสอบ" });
check("หัวหน้าอนุมัติแก้เวลา", !r.error, r.error?.message);
n = await emp.c.from("notifications").select("kind, title").eq("kind", "correction_result");
check("พนักงานได้แจ้งเตือนผลอนุมัติ", (n.data ?? []).length === 1, n.data?.[0]?.title);

let ot = await sup.c.rpc("warehouse_ot", { p_wh: wh.id, p_from: y, p_to: y });
const row = (ot.data ?? []).find((x) => x.user_id === emp.id);
check("คำนวณ OT จากเวลาจริง", row && Number(row.ot_hours) === 2 && Number(row.ot_rate) === 1.5 && row.approval === "pending", ot.error?.message ?? JSON.stringify(row && { h: row.ot_hours, r: row.ot_rate, a: row.approval }));
r = await emp.c.rpc("decide_ot", { p_items: [{ user_id: emp.id, work_date: y }], p_approve: true });
check("อนุมัติ OT ตัวเองไม่ได้", !!r.error);
r = await emp.c.rpc("warehouse_ot", { p_wh: wh.id, p_from: y, p_to: y });
check("พนักงานดู OT ทั้งคลังไม่ได้", !!r.error);
r = await sup.c.rpc("decide_ot", { p_items: [{ user_id: emp.id, work_date: y }], p_approve: true });
check("หัวหน้าอนุมัติ OT", r.data === 1, r.error?.message);
const mine = await emp.c.rpc("my_ot", { p_from: y, p_to: y });
check("พนักงานเห็น OT ของตัวเองว่าอนุมัติแล้ว", mine.data?.[0]?.approval === "approved", mine.error?.message);

// รายงาน
const d = await sup.c.rpc("warehouse_diligence", { p_wh: wh.id, p_month: month });
check("รายงานเบี้ยขยัน (ยังไม่ตั้งวันเริ่มใช้ = ไม่ได้)", !d.error && (d.data ?? []).every((x) => Number(x.amount) === 0), d.error?.message);
const t = await sup.c.rpc("warehouse_travel", { p_wh: wh.id, p_from: month, p_to: y });
check("รายงานค่าเดินทาง", !t.error, t.error?.message);
const l = await sup.c.rpc("warehouse_leave_summary", { p_wh: wh.id, p_from: month, p_to: y });
check("รายงานสรุปการลา", !l.error, l.error?.message);
const ds = await adm.c.rpc("dashboard_summary", { p_date: y });
check("ภาพรวมผู้บริหาร (แอดมินเห็นเฉพาะคลังตัวเอง)", !ds.error && ds.data.length === 1 && ds.data[0].code === "ZZTEST", ds.error?.message ?? ds.data?.map((x) => x.code).join(","));
const de = await emp.c.rpc("dashboard_summary", { p_date: y });
check("พนักงานดูภาพรวมไม่ได้", !!de.error);
const pp = await sup.c.rpc("payroll_period", { p_month: month });
check("รอบเงินเดือน", !pp.error && (Array.isArray(pp.data) ? pp.data[0] : pp.data)?.p_start === month, pp.error?.message);

// แจ้งเตือน: อ่านแล้ว / เห็นเฉพาะของตัวเอง
const all = await emp.c.from("notifications").select("user_id");
check("เห็นเฉพาะแจ้งเตือนของตัวเอง", (all.data ?? []).every((x) => x.user_id === emp.id));
r = await emp.c.rpc("mark_notifications_read", { p_ids: null });
check("กดอ่านแล้ว", !r.error && r.data >= 1, r.error?.message);
r = await emp.c.from("notifications").insert({ user_id: sup.id, kind: "x", title: "ปลอม" });
check("สร้างแจ้งเตือนเองไม่ได้", !!r.error);
r = await emp.c.rpc("run_jobs");
check("พนักงานสั่งงานอัตโนมัติไม่ได้", !!r.error);

console.log(failed ? `\nไม่ผ่าน ${failed} ข้อ` : "\nผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

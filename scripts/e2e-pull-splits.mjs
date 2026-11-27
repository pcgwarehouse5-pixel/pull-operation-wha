// ทดสอบการแตกยอดงานอัตโนมัติ (migration 0037) กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create)
// ใช้: node scripts/e2e-pull-splits.mjs   (แตะเฉพาะคลัง ZZTEST แล้วลบค่าที่สร้างทิ้งเมื่อจบ)
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
const tomorrow = new Date(Date.parse(today + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);

try {
  await adm.c.rpc("set_pull_skills", { p_wh: wh.id, p_skills: ["RT จ่าย(Domestics)", "RT เติม(Domestics)", "Picker จ่าย"] });
  const type = async (name, unit, sort) => (await adm.c.rpc("save_pull_workload_type", { p_id: null, p_wh: wh.id, p_name: name, p_unit: unit, p_sort: sort, p_active: true })).data;
  const total = await type("ยอดจ่ายรวม e2e", "piece", 1);
  const full = await type("จ่ายพาเลทเต็ม e2e", "pallet", 2);
  const fill = await type("เติม Pickface e2e", "pallet", 3);
  const pick = await type("จ่าย Picker e2e", "piece", 4);
  await adm.c.rpc("set_pull_type_skills", { p_type: full, p_skills: ["RT จ่าย(Domestics)"] });
  await adm.c.rpc("set_pull_type_skills", { p_type: fill, p_skills: ["RT เติม(Domestics)"] });
  await adm.c.rpc("set_pull_type_skills", { p_type: pick, p_skills: ["Picker จ่าย"] });
  const { data: tasks } = await adm.c.from("pull_tasks").select("id, skill_name").eq("warehouse_id", wh.id);
  const rate = { "RT จ่าย(Domestics)": 35, "RT เติม(Domestics)": 18, "Picker จ่าย": 180 };
  await adm.c.rpc("set_pull_rates", { p_wh: wh.id, p_from: today, p_rates: tasks.map((k) => ({ task_id: k.id, per_hour: rate[k.skill_name] })) });
  await adm.c.rpc("set_pull_shift_hours", { p_wh: wh.id, p_from: today, p_morning: 9.5, p_night: 9.5 });

  let r = await sup.c.rpc("set_pull_type_split", { p_type: full, p_from: tomorrow, p_source: total, p_share: 60, p_divisor: 32 });
  check("หัวหน้างานตั้งกฎแตกยอดไม่ได้", !!r.error, r.error?.message);
  for (const [t, share, div] of [[full, 60, 32], [fill, 40, 10], [pick, 40, 1]]) {
    r = await adm.c.rpc("set_pull_type_split", { p_type: t, p_from: tomorrow, p_source: total, p_share: share, p_divisor: div });
    if (r.error) throw r.error;
  }
  check("แอดมินตั้งกฎแตกยอด 3 งาน (เริ่มพรุ่งนี้)", true);

  r = await sup.c.rpc("save_pull_workloads", { p_wh: wh.id, p_date: tomorrow, p_shift: "morning", p_items: [{ type_id: total, volume: 10000 }] });
  check("หัวหน้างานกรอกยอดจ่ายรวม 10,000 ชิ้น", !r.error, r.error?.message);
  r = await sup.c.rpc("save_pull_workloads", { p_wh: wh.id, p_date: tomorrow, p_shift: "morning", p_items: [{ type_id: full, volume: 5 }] });
  check("กรอกยอดงานที่แตกแล้วเองไม่ได้", !!r.error && /อัตโนมัติ/.test(r.error.message), r.error?.message);

  r = await sup.c.rpc("pull_requirement_rows", { p_wh: wh.id, p_date: tomorrow, p_shift: "morning" });
  const vol = Object.fromEntries((r.data ?? []).map((x) => [x.skill_name, Number(x.volume)]));
  check("ยอดที่แตก: พาเลทเต็ม 187.5 / เติม 400 / Picker 4,000", vol["RT จ่าย(Domestics)"] === 187.5 && vol["RT เติม(Domestics)"] === 400 && vol["Picker จ่าย"] === 4000, JSON.stringify(vol));
  r = await sup.c.rpc("pull_requirements", { p_wh: wh.id, p_date: tomorrow, p_shift: "morning" });
  const need = Object.fromEntries((r.data ?? []).map((x) => [x.skill_name, x.required]));
  check("คนที่ต้องการ: RT จ่าย 1 / RT เติม 3 / Picker 3", need["RT จ่าย(Domestics)"] === 1 && need["RT เติม(Domestics)"] === 3 && need["Picker จ่าย"] === 3, JSON.stringify(need));

  r = await sup.c.from("pull_type_splits").select("type_id").eq("warehouse_id", wh.id);
  check("หัวหน้างานอ่านกฎแตกยอดของคลังตัวเองได้", (r.data ?? []).length === 3, `${r.data?.length} แถว`);
  r = await emp.c.from("pull_type_splits").select("type_id");
  check("พนักงานไม่เห็นกฎแตกยอด", (r.data ?? []).length === 0);
  r = await adm.c.from("pull_type_splits").insert({ type_id: full, effective_from: today, warehouse_id: wh.id, source_type_id: total, share_pct: 1, divisor: 1 });
  check("เขียนกฎตรงๆ ไม่ได้ (ต้องผ่านคำสั่งที่ตรวจสิทธิ์)", !!r.error);
  r = await adm.c.rpc("delete_pull_workload_type", { p_id: total });
  check("ลบยอดหลักที่งานอื่นใช้อยู่ไม่ได้", !!r.error, r.error?.message);
} finally {
  await service.from("pull_workload_types").delete().eq("warehouse_id", wh.id);
  await service.from("pull_skills").delete().eq("warehouse_id", wh.id);
  await service.from("pull_shift_hours").delete().eq("warehouse_id", wh.id);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

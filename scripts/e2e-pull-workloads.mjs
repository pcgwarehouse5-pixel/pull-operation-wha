// ทดสอบยอดงาน + คำนวณคนที่ต้องการ กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create + passwords)
// ใช้: node scripts/e2e-pull-workloads.mjs   (แตะเฉพาะคลัง ZZTEST แล้วลบค่าที่สร้างทิ้งเมื่อจบ)
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
const { data: wh5 } = await service.from("warehouses").select("id").eq("code", "WH5").single();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

try {
  // ตั้งค่าตามตัวอย่างในสไลด์ (RT รับ 25 / Picker จ่าย 45 / 8 ชม.)
  await adm.c.rpc("set_pull_skills", { p_wh: wh.id, p_skills: ["RT รับ(Domestics)", "Picker จ่าย"] });
  const t1 = (await adm.c.rpc("save_pull_workload_type", { p_id: null, p_wh: wh.id, p_name: "งานรับ e2e", p_unit: "pallet", p_sort: 1, p_active: true })).data;
  const t2 = (await adm.c.rpc("save_pull_workload_type", { p_id: null, p_wh: wh.id, p_name: "งานหยิบจ่าย e2e", p_unit: "piece", p_sort: 2, p_active: true })).data;
  await adm.c.rpc("set_pull_type_skills", { p_type: t1, p_skills: ["RT รับ(Domestics)"] });
  await adm.c.rpc("set_pull_type_skills", { p_type: t2, p_skills: ["Picker จ่าย"] });
  const { data: tasks } = await adm.c.from("pull_tasks").select("id, skill_name").eq("warehouse_id", wh.id);
  await adm.c.rpc("set_pull_rates", { p_wh: wh.id, p_from: today, p_rates: tasks.map((k) => ({ task_id: k.id, per_hour: k.skill_name === "Picker จ่าย" ? 45 : 25 })) });
  await adm.c.rpc("set_pull_shift_hours", { p_wh: wh.id, p_from: today, p_morning: 8, p_night: 8 });

  let r = await sup.c.rpc("save_pull_workloads", { p_wh: wh.id, p_date: today, p_shift: "morning", p_items: [{ type_id: t1, volume: 400 }, { type_id: t2, volume: 1200 }] });
  check("หัวหน้างานบันทึกยอดงานวันนี้", !r.error && r.data === 2, r.error?.message);
  r = await sup.c.rpc("pull_requirements", { p_wh: wh.id, p_date: today, p_shift: "morning" });
  const need = Object.fromEntries((r.data ?? []).map((x) => [x.skill_name, x.required]));
  check("คำนวณตรงตัวอย่างในสไลด์: RT รับ 2 คน, Picker 4 คน", need["RT รับ(Domestics)"] === 2 && need["Picker จ่าย"] === 4, JSON.stringify(need));
  r = await sup.c.rpc("pull_requirement_rows", { p_wh: wh.id, p_date: today, p_shift: "morning" });
  const pick = (r.data ?? []).find((x) => x.skill_name === "Picker จ่าย");
  check("รายละเอียดการคำนวณ (1,200 ÷ (8 × 45) = 3.33)", pick && Number(pick.volume) === 1200 && Number(pick.hours) === 8 && Number(pick.per_hour) === 45 && Math.abs(Number(pick.fte) - 3.3333) < 0.001, pick ? `${pick.volume}/${pick.hours}/${pick.per_hour}/${pick.fte}` : "");
  r = await sup.c.rpc("pull_requirements", { p_wh: wh.id, p_date: today, p_shift: "night" });
  check("กะที่ยังไม่กรอก = ไม่มีตัวเลข (ไม่ตีเป็น 0)", (r.data ?? []).every((x) => x.required === null && x.missing === "ยังไม่กรอกยอดงาน"));

  r = await sup.c.rpc("save_pull_workloads", { p_wh: wh.id, p_date: yesterday, p_shift: "morning", p_items: [{ type_id: t1, volume: 1 }] });
  check("หัวหน้างานแก้ยอดย้อนหลังไม่ได้", !!r.error);
  r = await adm.c.rpc("save_pull_workloads", { p_wh: wh.id, p_date: yesterday, p_shift: "morning", p_items: [{ type_id: t1, volume: 350 }] });
  check("แอดมินแก้ยอดย้อนหลังได้", !r.error, r.error?.message);
  r = await emp.c.rpc("save_pull_workloads", { p_wh: wh.id, p_date: today, p_shift: "morning", p_items: [{ type_id: t1, volume: 1 }] });
  check("พนักงานบันทึกยอดงานไม่ได้", !!r.error);
  r = await emp.c.rpc("pull_requirements", { p_wh: wh.id, p_date: today, p_shift: "morning" });
  check("พนักงานดูผลคำนวณไม่ได้", !!r.error);
  r = await sup.c.rpc("pull_requirements", { p_wh: wh5.id, p_date: today, p_shift: "morning" });
  check("หัวหน้างานดูผลคำนวณคลังอื่นไม่ได้", !!r.error);
  const rows = await sup.c.from("pull_workloads").select("volume").eq("warehouse_id", wh.id);
  check("หัวหน้างานอ่านยอดงานคลังตัวเอง", (rows.data ?? []).length === 3, `${rows.data?.length} แถว`);
  const empRows = await emp.c.from("pull_workloads").select("volume");
  check("พนักงานไม่เห็นยอดงาน", (empRows.data ?? []).length === 0);
  r = await sup.c.from("pull_workloads").insert({ warehouse_id: wh.id, work_date: today, shift: "night", workload_type_id: t1, volume: 1 });
  check("เขียนยอดงานตรงๆ ไม่ได้", !!r.error);
} finally {
  await service.from("pull_workload_types").delete().eq("warehouse_id", wh.id);
  await service.from("pull_skills").delete().eq("warehouse_id", wh.id);
  await service.from("pull_shift_hours").delete().eq("warehouse_id", wh.id);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

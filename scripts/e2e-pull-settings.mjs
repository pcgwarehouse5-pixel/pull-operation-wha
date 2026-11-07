// ทดสอบการตั้งค่า Pull Operation กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create + passwords)
// ใช้: node scripts/e2e-pull-settings.mjs   (แตะเฉพาะคลัง ZZTEST แล้วลบค่าที่สร้างทิ้งเมื่อจบ)
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

try {
  let r = await adm.c.rpc("set_pull_skills", { p_wh: wh.id, p_skills: ["OP ลากรับ", "RT รับ(Domestics)"] });
  check("แอดมินเปิดทักษะที่ดึงได้ของคลังตัวเอง", !r.error, r.error?.message);
  r = await adm.c.rpc("set_pull_skills", { p_wh: wh5.id, p_skills: ["OP ลากรับ"] });
  check("แอดมินแก้ทักษะของคลังอื่นไม่ได้", !!r.error);
  r = await sup.c.rpc("set_pull_skills", { p_wh: wh.id, p_skills: ["OP ลากรับ"] });
  check("หัวหน้างานตั้งค่าไม่ได้", !!r.error);

  const t = await adm.c.rpc("save_pull_workload_type", { p_id: null, p_wh: wh.id, p_name: "งานรับ e2e", p_unit: "pallet", p_sort: 1, p_active: true });
  check("แอดมินเพิ่มประเภทงาน", !t.error && !!t.data, t.error?.message);
  r = await adm.c.rpc("set_pull_type_skills", { p_type: t.data, p_skills: ["OP ลากรับ", "RT รับ(Domestics)"] });
  check("ผูกทักษะกับประเภทงาน", !r.error, r.error?.message);
  const { data: tasks } = await adm.c.from("pull_tasks").select("id, skill_name").eq("workload_type_id", t.data);
  check("อ่านงานที่ผูกแล้วได้ 2 งาน", tasks?.length === 2);

  r = await adm.c.rpc("set_pull_rates", { p_wh: wh.id, p_from: today, p_rates: tasks.map((k) => ({ task_id: k.id, per_hour: k.skill_name === "OP ลากรับ" ? 32 : 30 })), p_note: "e2e" });
  check("บันทึก Productivity พร้อมวันที่เริ่มใช้", !r.error && r.data === 2, r.error?.message);
  r = await adm.c.rpc("set_pull_rates", { p_wh: wh.id, p_from: "2020-01-01", p_rates: [{ task_id: tasks[0].id, per_hour: 1 }] });
  check("ย้อนหลังไม่ได้", !!r.error && /ไม่ย้อนหลัง/.test(r.error.message));
  r = await adm.c.rpc("set_pull_shift_hours", { p_wh: wh.id, p_from: today, p_morning: 10, p_night: 9.5 });
  check("บันทึกชั่วโมงต่อกะ", !r.error, r.error?.message);

  const rates = await sup.c.from("pull_task_rates").select("per_hour").eq("warehouse_id", wh.id);
  check("หัวหน้างานอ่าน Productivity คลังตัวเองได้", rates.data?.length === 2 && typeof rates.data[0].per_hour === "number", JSON.stringify(rates.data?.[0]));
  const other = await sup.c.from("pull_workload_types").select("id").eq("warehouse_id", wh5.id);
  check("หัวหน้างานไม่เห็นประเภทงานของคลังอื่น", (other.data ?? []).length === 0);
  const ps = await sup.c.from("pull_skills").select("skill_name").eq("warehouse_id", wh5.id);
  check("หัวหน้างานเห็นทักษะที่คลังอื่นเปิด (ตารางคลัง × ทักษะ)", (ps.data ?? []).length > 0, `${ps.data?.length} ทักษะ`);
  const empRead = await emp.c.from("pull_task_rates").select("per_hour");
  check("พนักงานไม่เห็นการตั้งค่า", (empRead.data ?? []).length === 0);
  r = await emp.c.rpc("pull_skill_counts");
  check("พนักงานดูจำนวนคนต่อทักษะไม่ได้", !!r.error);
  r = await sup.c.rpc("pull_skill_counts");
  check("หัวหน้างานดูจำนวนคนต่อทักษะได้ (ตัวเลขรวม)", !r.error && (r.data ?? []).length > 0 && !("first_name_th" in (r.data[0] ?? {})), `${r.data?.length} แถว`);
  r = await adm.c.from("pull_task_rates").update({ per_hour: 1 }).eq("warehouse_id", wh.id).select();
  check("แก้ตารางตรงๆ ไม่ได้", !!r.error || (r.data ?? []).length === 0);
} finally {
  // ลบค่าที่สร้างในคลังทดสอบ (งานและ Productivity ลบตามประเภทงาน)
  await service.from("pull_workload_types").delete().eq("warehouse_id", wh.id);
  await service.from("pull_skills").delete().eq("warehouse_id", wh.id);
  await service.from("pull_shift_hours").delete().eq("warehouse_id", wh.id);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

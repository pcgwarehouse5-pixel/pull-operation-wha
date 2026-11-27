// ทดสอบหน่วยงาน "หน้าร้านคลัง 5" (คลัง WH5S) กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create)
// ใช้: node scripts/e2e-storefront.mjs   (ย้ายบัญชี ztest เข้า WH5S/WH5 ชั่วคราว แล้วคืนค่าเดิมเมื่อจบ)
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

const { data: shop } = await service.from("warehouses").select("id, latitude, longitude, checkin_radius_m, units(code, modules)").eq("code", "WH5S").single();
const { data: wh5 } = await service.from("warehouses").select("id, latitude, longitude, checkin_radius_m").eq("code", "WH5").single();
check("มีคลัง WH5S ในหน่วยงาน SHOP5 ไม่ใช้ Pull", shop?.units?.code === "SHOP5" && shop.units.modules.length === 0);
check("WH5S ใช้พิกัด/รัศมีเดียวกับคลัง 5", shop.latitude === wh5.latitude && shop.longitude === wh5.longitude && shop.checkin_radius_m === wh5.checkin_radius_m);

const shopEmp = await login("ztest-emp");
const shopMgr = await login("ztest-dm");
const whaMgr = await login("ztest-emp2");
const ids = [shopEmp.id, shopMgr.id, whaMgr.id];
const { data: before } = await service.from("profiles").select("id, role, warehouse_id").in("id", ids);
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()).slice(0, 7) + "-01";

try {
  await service.from("profiles").update({ warehouse_id: shop.id }).eq("id", shopEmp.id);
  await service.from("profiles").update({ role: "dept_manager", warehouse_id: shop.id }).eq("id", shopMgr.id);
  await service.from("profiles").update({ role: "dept_manager", warehouse_id: wh5.id }).eq("id", whaMgr.id);

  let r = await whaMgr.c.from("profiles").select("id").eq("id", shopEmp.id);
  check("ผู้จัดการ WHA มองไม่เห็นพนักงานหน้าร้าน", !r.error && r.data.length === 0);
  r = await whaMgr.c.from("profiles").select("id", { count: "exact", head: true }).eq("warehouse_id", wh5.id);
  check("ผู้จัดการ WHA ยังเห็นพนักงานคลัง 5", !r.error && r.count > 0, `${r.count} คน`);
  r = await whaMgr.c.from("warehouses").select("code");
  check("ผู้จัดการ WHA ไม่เห็นคลัง WH5S", !r.error && !r.data.some((w) => w.code === "WH5S"));
  r = await shopMgr.c.from("profiles").select("id, warehouse_id");
  check("ผู้จัดการหน้าร้านเห็นเฉพาะคนหน้าร้าน", !r.error && r.data.length >= 2 && r.data.every((p) => p.warehouse_id === shop.id), `${r.data?.length} คน`);
  r = await shopEmp.c.rpc("my_modules");
  check("พนักงานหน้าร้านไม่มีเมนู Pull", !r.error && r.data.length === 0, JSON.stringify(r.data));
  r = await shopEmp.c.from("warehouses").select("code, latitude, longitude");
  check("พนักงานหน้าร้านเห็นคลัง WH5S พร้อมพิกัด (ใช้ลงเวลา)", !r.error && r.data.length === 1 && r.data[0].code === "WH5S" && r.data[0].latitude === wh5.latitude);
  r = await shopMgr.c.rpc("warehouse_diligence", { p_wh: shop.id, p_month: month });
  check("หน้าร้านไม่มีเบี้ยขยัน", !r.error && (r.data ?? []).length === 0, r.error?.message ?? `${r.data?.length} แถว`);
  r = await whaMgr.c.rpc("warehouse_diligence", { p_wh: wh5.id, p_month: month });
  check("คลัง 5 ยังคิดเบี้ยขยันตามเดิม", !r.error && (r.data ?? []).length > 0, r.error?.message ?? `${r.data?.length} แถว`);
  r = await shopMgr.c.rpc("setting", { p_key: "timesheet.form", p_date: month });
  check("หัวใบลงเวลาหน้าร้าน = ค่าเดียวกับคลัง 5", !r.error && JSON.stringify(r.data?.wh?.WH5S) === JSON.stringify(r.data?.wh?.WH5), JSON.stringify(r.data?.wh?.WH5S));
  r = await shopMgr.c.rpc("can_supervise_warehouse", { p_wh: wh5.id });
  check("ผู้จัดการหน้าร้านดูแลคลัง 5 ไม่ได้", r.data === false, r.error?.message);
} finally {
  for (const p of before) await service.from("profiles").update({ role: p.role, warehouse_id: p.warehouse_id }).eq("id", p.id);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

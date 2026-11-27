// ทดสอบ "หน่วยงาน" กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create)
// ใช้: node scripts/e2e-units.mjs   (ย้ายคลัง ZZTEST ไปหน่วยงานทดสอบ ZZUNIT ชั่วคราว แล้วคืนค่าทั้งหมดเมื่อจบ)
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

const { data: zz } = await service.from("warehouses").select("id, unit_id").eq("code", "ZZTEST").single();
const { data: wh5 } = await service.from("warehouses").select("id").eq("code", "WH5").single();
const { data: unit } = await service.from("units").insert({ code: "ZZUNIT", name: "หน่วยงานทดสอบ", modules: [] }).select("id").single();
const shopMgr = await login("ztest-dm"); // ผู้จัดการแผนกของหน่วยงานทดสอบ
const whaMgr = await login("ztest-emp2"); // ทำเป็นผู้จัดการแผนก WHA ชั่วคราว (คลังหลัก WH5)
const shopEmp = await login("ztest-emp");
const { data: before } = await service.from("profiles").select("id, role, warehouse_id").in("id", [shopMgr.id, whaMgr.id]);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

try {
  await service.from("warehouses").update({ unit_id: unit.id }).eq("id", zz.id);
  await service.from("profiles").update({ role: "dept_manager", warehouse_id: zz.id }).eq("id", shopMgr.id);
  await service.from("profiles").update({ role: "dept_manager", warehouse_id: wh5.id }).eq("id", whaMgr.id);

  const { count: total } = await service.from("profiles").select("id", { count: "exact", head: true });
  const { count: zzCount } = await service.from("profiles").select("id", { count: "exact", head: true }).eq("warehouse_id", zz.id);

  let t = Date.now();
  let r = await shopMgr.c.from("profiles").select("id, warehouse_id");
  check("ผู้จัดการหน่วยงานทดสอบเห็นเฉพาะคนในหน่วยงาน", !r.error && r.data.length === zzCount && r.data.every((p) => p.warehouse_id === zz.id), `${r.data?.length}/${zzCount} คน ${Date.now() - t} ms`);
  t = Date.now();
  r = await whaMgr.c.from("profiles").select("id, warehouse_id");
  check("ผู้จัดการ WHA เห็นทุกคนยกเว้นหน่วยงานทดสอบ", !r.error && r.data.length === total - zzCount && !r.data.some((p) => p.warehouse_id === zz.id), `${r.data?.length}/${total - zzCount} คน ${Date.now() - t} ms`);
  r = await whaMgr.c.from("warehouses").select("code");
  check("ผู้จัดการ WHA ไม่เห็นคลังของหน่วยงานอื่น", !r.error && !r.data.some((w) => w.code === "ZZTEST"));
  r = await shopMgr.c.from("warehouses").select("code");
  check("ผู้จัดการหน่วยงานทดสอบเห็นแค่คลังตัวเอง", !r.error && r.data.length === 1 && r.data[0].code === "ZZTEST", JSON.stringify(r.data));
  r = await whaMgr.c.rpc("can_supervise_warehouse", { p_wh: zz.id });
  check("ผู้จัดการ WHA ดูแลคลังหน่วยงานอื่นไม่ได้", r.data === false, r.error?.message);
  r = await whaMgr.c.rpc("can_approve_user", { p_user: shopEmp.id });
  check("ผู้จัดการ WHA อนุมัติคนหน่วยงานอื่นไม่ได้", r.data === false, r.error?.message);
  r = await shopMgr.c.rpc("can_approve_user", { p_user: shopEmp.id });
  check("ผู้จัดการหน่วยงานทดสอบอนุมัติคนในหน่วยงานได้", r.data === true, r.error?.message);
  t = Date.now();
  r = await whaMgr.c.from("shift_schedules").select("user_id").gte("work_date", today.slice(0, 8) + "01").limit(5000);
  check("ผู้จัดการ WHA ยังเปิดตารางกะของ WHA ได้", !r.error && r.data.length > 0, `${r.data?.length} แถว ${Date.now() - t} ms`);
  r = await whaMgr.c.rpc("pull_network", { p_from: today, p_to: today, p_shift: "morning" });
  check("ภาพรวมดึงคนของ WHA ไม่มีคลังหน่วยงานอื่น", !r.error && r.data.length > 0 && !r.data.some((x) => x.wh_code === "ZZTEST"), r.error?.message);
  r = await shopMgr.c.rpc("pull_pool", { p_to_wh: zz.id, p_date: today, p_shift: "morning" });
  check("หน่วยงานที่ไม่ใช้ระบบดึงคน เปิดคลังกลางไม่ได้", !!r.error && /ไม่ได้ใช้ระบบดึงคน/.test(r.error.message), r.error?.message);
  r = await shopMgr.c.rpc("my_modules");
  check("เมนูของหน่วยงานทดสอบไม่มี Pull", !r.error && Array.isArray(r.data) && r.data.length === 0, JSON.stringify(r.data));
  r = await whaMgr.c.rpc("my_modules");
  check("เมนูของ WHA มี Pull", !r.error && r.data?.includes("pull"), JSON.stringify(r.data));
  r = await shopMgr.c.from("dropdown_options").insert({ category: "position", value: "ZTEST", label: "ZTEST" }).select("id");
  check("หน่วยงานอื่นแก้ข้อมูลกลาง (ตัวเลือก/อัตรา) ไม่ได้", !!r.error, r.error?.message);
} finally {
  for (const p of before) await service.from("profiles").update({ role: p.role, warehouse_id: p.warehouse_id }).eq("id", p.id);
  await service.from("warehouses").update({ unit_id: zz.unit_id }).eq("id", zz.id);
  await service.from("dropdown_options").delete().eq("value", "ZTEST");
  await service.from("units").delete().eq("id", unit.id);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

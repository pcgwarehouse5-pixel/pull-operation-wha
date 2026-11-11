// ทดสอบคลังกลาง + จอง/ยกเลิก กับฐานข้อมูลจริง ด้วยบัญชีทดสอบชั่วคราว (สร้างก่อนด้วย node scripts/e2e-temp.mjs create + passwords)
// ใช้: node scripts/e2e-pull-bookings.mjs
// จองเฉพาะคนในคลังทดสอบ ZZTEST (ไม่จองพนักงานจริง จึงไม่มีแจ้งเตือนไปหาคนจริง) แล้วลบทุกอย่างที่สร้างเมื่อจบ
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
const emp1 = await login("ztest-emp");
const { data: wh } = await service.from("warehouses").select("id").eq("code", "ZZTEST").single();
const { data: wh5 } = await service.from("warehouses").select("id").eq("code", "WH5").single();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const SKILL = "RT รับ(Domestics)";

try {
  // เตรียม: คลังทดสอบเปิดทักษะ / พนักงานทดสอบมีทักษะและเข้ากะ STD1 (08:00) วันนี้
  const { data: sk } = await service.from("skills").select("id").eq("name", SKILL).limit(1).single();
  await service.from("employee_skills").insert([{ user_id: emp.id, skill_id: sk.id }, { user_id: emp1.id, skill_id: sk.id }]);
  await service.from("shift_schedules").insert([{ user_id: emp.id, work_date: today, shift_code: "STD1" }, { user_id: emp1.id, work_date: today, shift_code: "OFF" }]);
  await adm.c.rpc("set_pull_skills", { p_wh: wh.id, p_skills: [SKILL] });

  let r = await sup.c.rpc("pull_pool", { p_to_wh: wh.id, p_date: today, p_shift: "morning" });
  const me = (r.data ?? []).find((p) => p.user_id === emp.id);
  const off = (r.data ?? []).find((p) => p.user_id === emp1.id);
  check("คลังกลาง: พนักงานทดสอบเข้ากะเช้า = พร้อม และมีทักษะ", me?.status === "ready" && me.skills.includes(SKILL), r.error?.message ?? me?.status);
  check("คลังกลาง: วันหยุด = ไม่พร้อม พร้อมเหตุผล", off?.status === "unavailable" && /วันหยุด/.test(off.reason ?? ""), off?.reason);
  check("คลังกลางรวมพนักงานจากคลังจริงด้วย (ทุกคลังที่มีผู้ใช้)", (r.data ?? []).some((p) => p.warehouse_id === wh5.id), `${r.data?.length} คน`);
  check("คลังกลางไม่มีเลขบัตร/เบอร์โทร", me && !("phone" in me) && !("national_id" in me));

  r = await sup.c.rpc("book_pull", { p_to_wh: wh.id, p_date: today, p_shift: "morning", p_items: [{ user_id: emp.id, skill: SKILL }, { user_id: emp1.id, skill: SKILL }] });
  check("หัวหน้างานจอง: คนพร้อมจองได้ คนวันหยุดถูกปฏิเสธพร้อมเหตุผล", !r.error && r.data?.booked === 1 && r.data.conflicts.length === 1, r.error?.message ?? JSON.stringify(r.data));
  r = await sup.c.rpc("book_pull", { p_to_wh: wh.id, p_date: today, p_shift: "morning", p_items: [{ user_id: emp.id, skill: SKILL }] });
  check("จองซ้ำคนเดิมไม่ได้", r.data?.booked === 0 && r.data.conflicts.length === 1, JSON.stringify(r.data?.conflicts));
  r = await emp.c.rpc("book_pull", { p_to_wh: wh.id, p_date: today, p_shift: "morning", p_items: [{ user_id: emp.id, skill: SKILL }] });
  check("พนักงานจองไม่ได้", !!r.error);
  r = await sup.c.rpc("book_pull", { p_to_wh: wh5.id, p_date: today, p_shift: "morning", p_items: [{ user_id: emp.id, skill: SKILL }] });
  check("หัวหน้างานจองเข้าคลังอื่นไม่ได้", !!r.error);

  const mine = await emp.c.from("pull_bookings").select("id, skill_name, status").eq("user_id", emp.id);
  check("พนักงานเห็นงานที่ตัวเองถูกจอง", mine.data?.length === 1 && mine.data[0].status === "booked");
  const note = await emp.c.from("notifications").select("kind, title, link").in("kind", ["pull_booked", "pull_placed"]);
  check("พนักงานได้แจ้งเตือน \"หัวหน้าจัดตำแหน่งงานให้คุณ\" ลิงก์ไปหน้าตำแหน่งงาน", note.data?.length === 1 && note.data[0].kind === "pull_placed" && note.data[0].link === "/my-position", JSON.stringify(note.data));
  // เวลาพัก: หัวหน้าตั้ง → พนักงานเห็นและได้แจ้งเตือน / ตั้งค่าเดิมซ้ำไม่แจ้งซ้ำ
  r = await sup.c.rpc("set_pull_break", { p_id: mine.data[0].id, p_time: "12:00" });
  check("หัวหน้าตั้งเวลาพัก", !r.error, r.error?.message);
  await sup.c.rpc("set_pull_break", { p_id: mine.data[0].id, p_time: "12:00" });
  const brk = await emp.c.from("pull_bookings").select("break_time").eq("id", mine.data[0].id).single();
  check("พนักงานเห็นเวลาพักของตัวเอง", brk.data?.break_time === "12:00:00", brk.data?.break_time);
  const nb = await emp.c.from("notifications").select("title, link").eq("kind", "pull_break");
  check("พนักงานได้แจ้งเตือนเวลาพัก 1 ครั้ง (ตั้งซ้ำไม่แจ้งซ้ำ)", nb.data?.length === 1 && nb.data[0].title === "เวลาพักของคุณ: พัก 12:00" && nb.data[0].link === "/my-position", JSON.stringify(nb.data));
  r = await emp.c.rpc("set_pull_break", { p_id: mine.data[0].id, p_time: "13:00" });
  check("พนักงานตั้งเวลาพักเองไม่ได้", !!r.error);
  // ข้อมูลที่หน้าหลักของพนักงานใช้ (OT เดือนนี้ วันลาคงเหลือ ใบลาล่าสุด กะ)
  const m0 = today.slice(0, 8) + "01";
  const [o1, b1, l1, a1] = await Promise.all([
    emp.c.rpc("my_ot", { p_from: m0, p_to: today }),
    emp.c.rpc("leave_balance", { p_year: Number(today.slice(0, 4)) }),
    emp.c.from("leave_requests").select("id").eq("user_id", emp.id).limit(3),
    emp.c.rpc("my_attendance", { p_from: today, p_to: today }),
  ]);
  check("พนักงานดึง OT ของตัวเองได้", !o1.error, o1.error?.message);
  check("พนักงานดึงวันลาคงเหลือได้ (มีประเภทลา)", !b1.error && (b1.data ?? []).length > 0, b1.error?.message ?? `${b1.data?.length} ประเภท`);
  check("พนักงานดึงใบลาของตัวเองได้", !l1.error, l1.error?.message);
  check("พนักงานดึงกะวันนี้ได้", !a1.error && (a1.data ?? []).length === 1, a1.error?.message);
  const other = await emp1.c.from("pull_bookings").select("id");
  check("พนักงานคนอื่นไม่เห็นการจองของเพื่อน", (other.data ?? []).length === 0);

  const id = mine.data[0].id;
  r = await sup.c.rpc("cancel_pull_booking", { p_id: id, p_reason: "" });
  check("ยกเลิกต้องมีเหตุผล", !!r.error);
  r = await sup.c.rpc("cancel_pull_booking", { p_id: id, p_reason: "จองผิด" });
  check("ยกเลิกพร้อมเหตุผล", !r.error, r.error?.message);
  const after = await sup.c.from("pull_bookings").select("status, cancel_reason").eq("id", id).single();
  check("บันทึกสถานะและเหตุผลการยกเลิก", after.data?.status === "cancelled" && after.data.cancel_reason === "จองผิด");
  const n2 = await emp.c.from("notifications").select("title, link").eq("kind", "pull_cancelled");
  check("พนักงานได้แจ้งเตือนว่ายกเลิก (ตำแหน่งในคลังตัวเอง)", n2.data?.length === 1 && n2.data[0].title === "ยกเลิกตำแหน่งงานที่จัดไว้" && n2.data[0].link === "/my-position", JSON.stringify(n2.data));
  r = await sup.c.from("pull_bookings").update({ status: "booked" }).eq("id", id).select();
  check("แก้รายการจองตรงๆ ไม่ได้", !!r.error || (r.data ?? []).length === 0);
} finally {
  await service.from("pull_bookings").delete().eq("to_warehouse_id", wh.id);
  await service.from("pull_skills").delete().eq("warehouse_id", wh.id);
  await service.from("shift_schedules").delete().in("user_id", [emp.id, emp1.id]);
  await service.from("employee_skills").delete().in("user_id", [emp.id, emp1.id]);
}

console.log(failed ? `ไม่ผ่าน ${failed} ข้อ` : "ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);

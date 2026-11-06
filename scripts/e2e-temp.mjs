// สร้าง/ลบ คลังและบัญชีทดสอบชั่วคราว สำหรับทดสอบระบบจริงก่อนส่งงาน
// ใช้: node scripts/e2e-temp.mjs create   แล้วหลังทดสอบเสร็จ   node scripts/e2e-temp.mjs delete
// บัญชีทดสอบใช้รหัสสุ่ม เก็บใน .env.e2e.local (ไม่ขึ้น GitHub) ไม่ใช้รหัสเริ่มต้นจริงของพนักงาน
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const e = process.env;
const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const domain = e.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local";
const WH = "ZZTEST";
const USERS = [
  { code: "ztest-admin", first: "ทดสอบแอดมิน", role: "admin", must: false },
  { code: "ztest-emp", first: "ทดสอบพนักงาน", role: "employee", must: true },
  { code: "ztest-sup", first: "ทดสอบหัวหน้า", role: "supervisor", must: false },
  { code: "ztest-emp2", first: "ทดสอบพนักงานสอง", role: "employee", must: false },
];

async function findUser(code) {
  const { data } = await admin.from("profiles").select("id").eq("employee_code", code).maybeSingle();
  return data?.id ?? null;
}

// รหัสสุ่มสำหรับบัญชีทดสอบ (ตัวอักษร+ตัวเลข 14 ตัว)
async function setTestPasswords() {
  const lines = [];
  for (const u of USERS) {
    const pw = "T" + crypto.randomBytes(9).toString("base64url").replace(/[-_]/g, "x").slice(0, 12) + "9";
    const id = await findUser(u.code);
    const { error } = await admin.auth.admin.updateUserById(id, { password: pw });
    if (error) throw error;
    lines.push(`E2E_${u.code.replace(/-/g, "_").toUpperCase()}=${pw}`);
  }
  fs.writeFileSync(".env.e2e.local", "# รหัสบัญชีทดสอบชั่วคราว (ลบได้)\n" + lines.join("\n") + "\n");
}

const cmd = process.argv[2];
if (cmd === "passwords") {
  await setTestPasswords();
  console.log("ตั้งรหัสสุ่มให้บัญชีทดสอบแล้ว (เก็บใน .env.e2e.local)");
} else if (cmd === "create") {
  const { data: wh, error: we } = await admin.from("warehouses").insert({ code: WH, name: "คลังทดสอบชั่วคราว (ลบได้)", latitude: 13.0, longitude: 100.0, checkin_radius_m: 100 }).select("id").single();
  if (we) throw we;
  for (const u of USERS) {
    const { data, error } = await admin.auth.admin.createUser({ email: `${u.code}@${domain}`, password: e.DEFAULT_USER_PASSWORD, email_confirm: true });
    if (error) throw error;
    const { error: pe } = await admin.from("profiles").insert({ id: data.user.id, employee_code: u.code, first_name_th: u.first, role: u.role, warehouse_id: wh.id, must_change_password: u.must });
    if (pe) throw pe;
  }
  await setTestPasswords();
  console.log("สร้างคลัง ZZTEST และบัญชี", USERS.map((u) => u.code).join(", "), "แล้ว (รหัสอยู่ใน .env.e2e.local)");
} else if (cmd === "delete") {
  // ลบทุกบัญชีที่ขึ้นต้นด้วย ztest- (รวมบัญชีที่สร้างระหว่างทดสอบปุ่มเพิ่มผู้ใช้)
  const { data: tests } = await admin.from("profiles").select("id").ilike("employee_code", "ztest-%");
  const ids = (tests ?? []).map((t) => t.id);
  // แจ้งเตือนที่บัญชีจริง (เช่น ผู้บริหาร) ได้รับจากใบลา/คำขอแก้เวลาของบัญชีทดสอบ
  if (ids.length) {
    const { data: lv } = await admin.from("leave_requests").select("id").in("user_id", ids);
    const { data: cr } = await admin.from("attendance_corrections").select("id").in("user_id", ids);
    for (const x of lv ?? []) await admin.from("notifications").delete().like("dedup_key", `leave:${x.id}:%`);
    for (const x of cr ?? []) await admin.from("notifications").delete().like("dedup_key", `corr:${x.id}:%`);
  }
  // ไฟล์แนบใบลาของบัญชีทดสอบ
  for (const id of ids) {
    const { data: files } = await admin.storage.from("leave-attachments").list(id);
    if (files?.length) await admin.storage.from("leave-attachments").remove(files.map((x) => `${id}/${x.name}`));
  }
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  const { data: wh } = await admin.from("warehouses").select("id").eq("code", WH).maybeSingle();
  if (wh) {
    const { error } = await admin.from("warehouses").delete().eq("id", wh.id);
    if (error) throw error;
  }
  // ลบประวัติที่เกิดจากการทดสอบ (ไม่ใช่ข้อมูลจริง)
  const targets = [...ids, ...(wh ? [wh.id] : [])];
  if (targets.length) {
    const { error: a1 } = await admin.from("audit_logs").delete().in("record_id", targets);
    const { error: a2 } = await admin.from("audit_logs").delete().in("actor_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const { error: a3 } = wh ? await admin.from("audit_logs").delete().eq("warehouse_id", wh.id) : { error: null };
    if (a1 || a2 || a3) throw a1 || a2 || a3;
  }
  fs.rmSync(".env.e2e.local", { force: true });
  console.log(`ลบบัญชีทดสอบ ${ids.length} บัญชี, คลังทดสอบ ${wh ? 1 : 0} คลัง และประวัติที่เกี่ยวข้องแล้ว`);
} else {
  console.log("ใช้: node scripts/e2e-temp.mjs create | delete");
}

// ย้ายข้อมูลจากแอปเดิม (Lovable export) เข้าแอปใหม่: คลัง WH5/WH32, พนักงาน, คลังที่ดูแล, ตัวเลือกตั้งค่า, ทักษะ, อัตรากำลัง
// ใช้:
//   node scripts/import-lovable.mjs              ซ้อม: ตรวจและสรุปอย่างเดียว ไม่เขียนอะไร
//   node scripts/import-lovable.mjs --apply      นำเข้าจริง (รันซ้ำได้: ของที่มีแล้วจะอัปเดต/ข้าม ไม่ซ้ำ)
//   เลือกโฟลเดอร์ export เอง: --dir lovable-data/export-YYYYMMDD-HHMM (ค่าเริ่มต้น = โฟลเดอร์ล่าสุด)
// บัญชีใหม่ทุกคนใช้รหัสผ่านเริ่มต้น (DEFAULT_USER_PASSWORD) และต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { transform } from "./lib/lovable-transform.mjs";

process.loadEnvFile(".env.local");
const e = process.env;
const APPLY = process.argv.includes("--apply");
const dirArg = process.argv.indexOf("--dir");
const dir =
  dirArg > 0
    ? process.argv[dirArg + 1]
    : path.join("lovable-data", fs.readdirSync("lovable-data").filter((d) => d.startsWith("export-")).sort().pop());
const domain = e.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local";
const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// เน็ตสะดุดชั่วคราว: ลองใหม่สูงสุด 4 ครั้ง (รอ 1, 2, 4, 8 วินาที)
const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|network|timeout|502|503|504|429/i;
async function retry(fn) {
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fn();
    } catch (err) {
      res = { error: err };
    }
    const msg = res?.error ? String(res.error.message ?? res.error) : "";
    if (!res?.error || !TRANSIENT.test(msg) || i >= 4) return res;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
}

const read = (t) => {
  const f = path.join(dir, `${t}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) : [];
};
const src = Object.fromEntries(
  ["warehouses", "profiles", "user_roles", "warehouse_access_permissions", "dropdown_options", "skills", "employee_skills", "organization_budget"].map((t) => [t, read(t)]),
);
const out = transform(src);

async function all(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
async function allAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

// ---------- ตรวจกับฐานข้อมูลปัจจุบัน (อ่านอย่างเดียว) ----------
const [dbWh, dbProfiles, dbOptions, dbUw, authUsers, dbSkills, dbEs, dbBudgets] = await Promise.all([
  all("warehouses", "id, code"),
  all("profiles", "id, employee_code, status"),
  all("dropdown_options", "category, value"),
  all("user_warehouses", "user_id, warehouse_id"),
  allAuthUsers(),
  all("skills", "id, position, name"),
  all("employee_skills", "user_id, skill_id"),
  all("headcount_budgets", "warehouse_id, position"),
]);
const whById = new Set(dbWh.map((w) => w.id));
const whCodeOwner = Object.fromEntries(dbWh.map((w) => [w.code, w.id]));
const profById = new Set(dbProfiles.map((p) => p.id));
const statusById = Object.fromEntries(dbProfiles.map((p) => [p.id, p.status]));
const codeOwner = Object.fromEntries(dbProfiles.map((p) => [p.employee_code.toLowerCase(), p.id]));
const authById = new Set(authUsers.map((u) => u.id));
const emailOwner = Object.fromEntries(authUsers.map((u) => [u.email?.toLowerCase(), u.id]));
const optKey = new Set(dbOptions.map((o) => `${o.category}|${o.value}`));
const uwKey = new Set(dbUw.map((x) => `${x.user_id}|${x.warehouse_id}`));

const conflicts = [];
for (const w of out.warehouses) if (whCodeOwner[w.code] && whCodeOwner[w.code] !== w.id) conflicts.push(`รหัสคลัง ${w.code} มีอยู่แล้ว (คนละคลัง)`);
const plan = { create: [], update: [], skip: [] };
for (const p of out.profiles) {
  const email = `${p.employee_code.toLowerCase()}@${domain}`;
  const ownerByCode = codeOwner[p.employee_code.toLowerCase()];
  const ownerByEmail = emailOwner[email];
  if (ownerByCode && ownerByCode !== p.id) conflicts.push(`รหัสพนักงาน ${p.employee_code} ถูกใช้โดยบัญชีอื่นในแอปใหม่แล้ว`);
  else if (ownerByEmail && ownerByEmail !== p.id) conflicts.push(`บัญชีล็อกอิน ${p.employee_code} มีอยู่แล้ว (คนละคน)`);
  else if (profById.has(p.id)) plan.update.push(p);
  else plan.create.push(p);
}
const newWh = out.warehouses.filter((w) => !whById.has(w.id));
const newOpts = out.options.filter((o) => !optKey.has(`${o.category}|${o.value}`));
const newUw = out.userWarehouses.filter((x) => !uwKey.has(`${x.user_id}|${x.warehouse_id}`));
const skillById = new Set(dbSkills.map((s) => s.id));
const skillByName = new Set(dbSkills.map((s) => `${s.position}|${s.name}`));
const newSkills = out.skills.filter((s) => !skillById.has(s.id) && !skillByName.has(`${s.position}|${s.name}`));
const okSkill = new Set([...skillById, ...newSkills.map((s) => s.id)]);
const esKey = new Set(dbEs.map((x) => `${x.user_id}|${x.skill_id}`));
const newEs = out.employeeSkills.filter((x) => okSkill.has(x.skill_id) && !esKey.has(`${x.user_id}|${x.skill_id}`));
const budgetKey = new Set(dbBudgets.map((b) => `${b.warehouse_id}|${b.position}`));
const newBudgets = out.budgets.filter((b) => !budgetKey.has(`${b.warehouse_id}|${b.position}`));

const count = (rows, f) => Object.entries(rows.reduce((a, r) => ((a[f(r)] = (a[f(r)] || 0) + 1), a), {})).map(([k, n]) => `${k} ${n}`).join(", ");
const whCode = Object.fromEntries(out.warehouses.map((w) => [w.id, w.code]));
console.log(`\nข้อมูลจาก: ${dir}`);
console.log(`โหมด: ${APPLY ? "นำเข้าจริง" : "ซ้อม (ยังไม่เขียนอะไร)"}\n`);
console.log(`คลัง: ${out.warehouses.map((w) => `${w.code} "${w.name}"`).join(", ")} | ใหม่ ${newWh.length} มีแล้ว ${out.warehouses.length - newWh.length}`);
console.log(`พนักงาน: ${out.profiles.length} คน (${count(out.profiles, (p) => whCode[p.warehouse_id])})`);
console.log(`  สร้างบัญชีใหม่ ${plan.create.length} | อัปเดตข้อมูล (มีบัญชีแล้ว) ${plan.update.length}`);
console.log(`  บทบาท: ${count(out.profiles, (p) => p.role)} | สถานะ: ${count(out.profiles, (p) => p.status)}`);
console.log(`  ประเภทพนักงาน: ${count(out.profiles, (p) => p.employment_type ?? "-")}`);
console.log(`คลังเพิ่มเติมที่ดูแล: ${out.userWarehouses.length} รายการ (ใหม่ ${newUw.length})`);
console.log(`ตัวเลือกตั้งค่า: ${out.options.length} รายการ (ใหม่ ${newOpts.length}) | ตำแหน่งที่เพิ่มเข้ารายการ: ${out.addedPositions.length}`);
console.log(`ทักษะ: ${out.skills.length} รายการ (ใหม่ ${newSkills.length}) | ทักษะของพนักงาน: ${out.employeeSkills.length} (ใหม่ ${newEs.length})`);
console.log(`อัตรากำลัง (ใส่ให้คลัง 5): ${out.budgets.length} ตำแหน่ง (ใหม่ ${newBudgets.length}) — มีอยู่แล้วจะไม่ทับค่าที่แก้ในแอป`);
if (out.issues.length) {
  console.log(`\nรายการที่ข้าม/ต้องรู้ (${out.issues.length}):`);
  for (const i of out.issues) console.log(`  - ${i.type}: ${i.code}${i.detail ? ` (${i.detail})` : ""}`);
}
if (conflicts.length) {
  console.log(`\nชนกับข้อมูลในแอปใหม่ (${conflicts.length}) — ต้องแก้ก่อนนำเข้า:`);
  for (const c of conflicts) console.log(`  - ${c}`);
}
if (!APPLY) {
  console.log("\nยังไม่ได้เขียนอะไรลงฐานข้อมูล ถ้าถูกต้องให้รันซ้ำพร้อม --apply");
  process.exit(conflicts.length ? 1 : 0);
}
if (conflicts.length) {
  console.log("\nหยุด: มีข้อมูลชนกัน");
  process.exit(1);
}

// ---------- นำเข้าจริง ----------
const pw = e.DEFAULT_USER_PASSWORD;
if (!pw || pw.length < 6) throw new Error("ต้องตั้ง DEFAULT_USER_PASSWORD ใน .env.local (อย่างน้อย 6 ตัว)");
const fail = (step, err) => {
  console.error(`\nไม่สำเร็จที่ขั้น ${step}: ${err.message}`);
  console.error("ข้อมูลที่นำเข้าไปแล้วยังอยู่ รันคำสั่งเดิมซ้ำได้เมื่อแก้ปัญหาแล้ว (จะไม่สร้างซ้ำ)");
  process.exit(1);
};

if (newWh.length) {
  const { error } = await retry(() => admin.from("warehouses").insert(newWh));
  if (error) fail("คลัง", error);
}
if (newOpts.length) {
  const { error } = await retry(() => admin.from("dropdown_options").insert(newOpts));
  if (error) fail("ตัวเลือกตั้งค่า", error);
}
console.log(`\nนำเข้าคลัง ${newWh.length} และตัวเลือก ${newOpts.length} แล้ว`);

let created = 0;
for (const p of plan.create) {
  if (!authById.has(p.id)) {
    const { error } = await retry(() =>
      admin.auth.admin.createUser({
        id: p.id,
        email: `${p.employee_code.toLowerCase()}@${domain}`,
        password: pw,
        email_confirm: true,
        ...(p.status === "resigned" ? { ban_duration: "876000h" } : {}),
      }),
    );
    // ลองใหม่หลังเน็ตสะดุดอาจเจอว่าสร้างไปแล้ว: ถือว่าผ่าน
    if (error && !/already/i.test(error.message)) fail(`สร้างบัญชี ${p.employee_code}`, error);
  }
  const { error } = await retry(() => admin.from("profiles").upsert({ ...p, must_change_password: true }, { onConflict: "id", ignoreDuplicates: true }));
  if (error) fail(`บันทึกข้อมูล ${p.employee_code}`, error);
  if (++created % 25 === 0) console.log(`  สร้างบัญชีแล้ว ${created}/${plan.create.length}`);
}
// บัญชีที่มีอยู่แล้ว: อัปเดตข้อมูลตามแอปเดิมทีละชุด 100 คน (ไม่แตะบทบาท รหัสผ่าน และสถานะการตั้งรหัส)
const updates = plan.update.map((p) => {
  const row = { ...p };
  delete row.role;
  return row;
});
for (let i = 0; i < updates.length; i += 100) {
  const { error } = await retry(() => admin.from("profiles").upsert(updates.slice(i, i + 100), { onConflict: "id" }));
  if (error) fail(`อัปเดตข้อมูลพนักงานชุดที่ ${i / 100 + 1}`, error);
}
// สถานะลาออก: ปิด/เปิดการล็อกอินให้ตรงกับแอปเดิม (กรณีคนลาออกหรือกลับมาทำงานระหว่างรอบนำเข้า)
for (const p of plan.update.filter((x) => x.status !== statusById[x.id])) {
  const { error } = await retry(() => admin.auth.admin.updateUserById(p.id, { ban_duration: p.status === "resigned" ? "876000h" : "none" }));
  if (error) fail(`ปรับสถานะล็อกอิน ${p.employee_code}`, error);
}
if (newUw.length) {
  const { error } = await retry(() => admin.from("user_warehouses").insert(newUw));
  if (error) fail("คลังเพิ่มเติม", error);
}
// ทักษะ → ทักษะของพนักงาน (หลังสร้างบัญชีครบ) → อัตรากำลัง
if (newSkills.length) {
  const { error } = await retry(() => admin.from("skills").insert(newSkills));
  if (error) fail("รายการทักษะ", error);
}
for (let i = 0; i < newEs.length; i += 500) {
  const { error } = await retry(() => admin.from("employee_skills").upsert(newEs.slice(i, i + 500), { onConflict: "user_id,skill_id", ignoreDuplicates: true }));
  if (error) fail("ทักษะของพนักงาน", error);
}
if (newBudgets.length) {
  const { error } = await retry(() => admin.from("headcount_budgets").insert(newBudgets));
  if (error) fail("อัตรากำลัง", error);
}
await admin.from("audit_logs").insert({
  action: "import",
  table_name: "profiles",
  new_data: { source: dir, warehouses: newWh.length, options: newOpts.length, created, updated: plan.update.length, user_warehouses: newUw.length, skills: newSkills.length, employee_skills: newEs.length, budgets: newBudgets.length },
});
console.log(
  `\nเสร็จ: สร้างบัญชี ${created} | อัปเดต ${plan.update.length} | คลังเพิ่มเติม ${newUw.length} | ทักษะ ${newSkills.length} | ทักษะพนักงาน ${newEs.length} | อัตรากำลัง ${newBudgets.length}`,
);

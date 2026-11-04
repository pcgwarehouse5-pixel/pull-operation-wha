// สร้างผู้ดูแลระบบสูงสุดคนแรก (คนถัดไปกำหนดผ่านหน้า "ผู้ใช้และสิทธิ์" ในแอป)
// ใช้: npm run create-admin   แล้วตอบคำถามในหน้าจอ
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.local");
} catch {
  console.error("ไม่พบไฟล์ .env.local");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const domain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local";
if (!url || !key) {
  console.error("ต้องมี NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q) => new Promise((res) => rl.question(q, res));
// ซ่อนรหัสผ่านตอนพิมพ์
const askHidden = (q) =>
  new Promise((res) => {
    const write = rl._writeToOutput;
    rl._writeToOutput = (s) => rl.output.write(s.includes(q) ? s : "*".repeat(s.length ? 1 : 0));
    rl.question(q, (a) => {
      rl._writeToOutput = write;
      rl.output.write("\n");
      res(a);
    });
  });

const code = (await ask("รหัสพนักงาน / ชื่อผู้ใช้ (เช่น admin01): ")).trim();
const firstName = (await ask("ชื่อ: ")).trim();
const lastName = (await ask("นามสกุล (เว้นว่างได้): ")).trim();
const password = await askHidden("รหัสผ่าน (อย่างน้อย 8 ตัว): ");
rl.close();

if (!/^[A-Za-z0-9._-]{1,30}$/.test(code) || !firstName || password.length < 8) {
  console.error("ข้อมูลไม่ถูกต้อง: รหัสใช้ได้ A-Z a-z 0-9 . _ - , ต้องมีชื่อ, รหัสผ่าน 8 ตัวขึ้นไป");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.createUser({
  email: `${code.toLowerCase()}@${domain}`,
  password,
  email_confirm: true,
});
if (error) {
  console.error("สร้างบัญชีไม่สำเร็จ:", error.message);
  process.exit(1);
}
const { error: pe } = await admin.from("profiles").insert({
  id: data.user.id,
  employee_code: code,
  first_name_th: firstName,
  last_name_th: lastName || null,
  role: "super_admin",
  must_change_password: false,
});
if (pe) {
  await admin.auth.admin.deleteUser(data.user.id);
  console.error("บันทึกข้อมูลผู้ใช้ไม่สำเร็จ:", pe.message);
  process.exit(1);
}
console.log(`สร้างผู้ดูแลระบบสูงสุด "${code}" แล้ว เข้าแอปด้วยรหัสนี้ได้เลย`);

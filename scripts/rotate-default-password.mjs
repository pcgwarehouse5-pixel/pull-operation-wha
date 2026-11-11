// เปลี่ยนรหัสผ่านเริ่มต้นของบัญชีที่ "ยังไม่เคยตั้งรหัสเอง" (must_change_password = true) เป็นค่าใหม่ใน .env.local
// ใช้: 1) แก้ DEFAULT_USER_PASSWORD ใน .env.local เป็นรหัสใหม่ (พิมพ์เอง ห้ามส่งในแชท)
//      2) node scripts/rotate-default-password.mjs            ← ดูอย่างเดียว ว่าจะเปลี่ยนกี่บัญชี
//      3) node scripts/rotate-default-password.mjs --apply    ← เปลี่ยนจริง
//      4) แก้ DEFAULT_USER_PASSWORD บน Vercel ให้ตรงกัน แล้ว Redeploy
// สคริปต์ไม่แสดงรหัสผ่านออกหน้าจอ · ไม่แตะบัญชีที่ตั้งรหัสเองแล้ว และบัญชีผู้ดูแลระบบสูงสุด
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const e = process.env;
const pw = e.DEFAULT_USER_PASSWORD ?? "";
const apply = process.argv.includes("--apply");
const domain = e.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local";

// รหัสเริ่มต้นใช้ร่วมกันหลายคน จึงต้องเดายาก (ตัวเลขล้วนได้ เพื่อให้พิมพ์บนมือถือง่าย แต่ต้องยาวพอและไม่เป็นรูปแบบ)
function weakness(p) {
  if (p.length < 8) return "สั้นกว่า 8 ตัว";
  if (/^(.)\1+$/.test(p)) return "เป็นตัวเดียวกันทั้งหมด";
  const run = (s) => [...s].every((c, i) => i === 0 || Math.abs(s.charCodeAt(i) - s.charCodeAt(i - 1)) === 1);
  if (run(p.toLowerCase())) return "เป็นตัวเรียงกัน";
  if (/^(.{1,4})\1+$/.test(p)) return "เป็นชุดซ้ำ เช่น 12121212";
  if (/^(?:(.)\1)+$/.test(p)) return "เป็นคู่ซ้ำ เช่น 11223344";
  if (/password|wha|admin|qwerty|1234|abcd|4321/i.test(p)) return "มีคำหรือเลขที่เดาง่าย";
  return null;
}
if (/^\d+$/.test(pw)) console.log("หมายเหตุ: รหัสเป็นตัวเลขล้วน ใช้ได้แต่เดาได้ง่ายกว่ารหัสที่มีตัวอักษร (พนักงานต้องเปลี่ยนเองตอนเข้าครั้งแรก)");
const weak = weakness(pw);
if (weak) {
  console.error(`รหัสผ่านเริ่มต้นใน .env.local ยังไม่ปลอดภัย (${weak}) แก้ก่อนแล้วรันใหม่`);
  process.exit(1);
}

const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// บัญชีที่ยังใช้รหัสเริ่มต้นอยู่ (ยังไม่เคยตั้งรหัสเอง)
const targets = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin.from("profiles").select("id, employee_code, role").eq("must_change_password", true).neq("role", "super_admin").range(from, from + 999);
  if (error) throw error;
  targets.push(...data);
  if (data.length < 1000) break;
}
console.log(`บัญชีที่ยังไม่เคยตั้งรหัสเอง: ${targets.length} บัญชี`);
if (!apply) {
  console.log("ดูอย่างเดียว · ใส่ --apply เพื่อเปลี่ยนจริง");
  process.exit(0);
}

// ทดสอบก่อนกับบัญชีชั่วคราว: เปลี่ยนรหัสแล้วเข้าระบบด้วยรหัสใหม่ได้จริง
const probe = `ztest-pwcheck-${Date.now()}`;
const { data: pu, error: pe } = await admin.auth.admin.createUser({ email: `${probe}@${domain}`, password: `Tmp${Date.now()}x9`, email_confirm: true });
if (pe) throw pe;
try {
  const { error: ue } = await admin.auth.admin.updateUserById(pu.user.id, { password: pw });
  if (ue) throw new Error(`Supabase ไม่รับรหัสนี้: ${ue.message}`);
  const anon = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: se } = await anon.auth.signInWithPassword({ email: `${probe}@${domain}`, password: pw });
  if (se) throw new Error(`ทดสอบเข้าระบบด้วยรหัสใหม่ไม่ผ่าน: ${se.message}`);
  console.log("ทดสอบกับบัญชีชั่วคราว: เข้าระบบด้วยรหัสใหม่ได้");
} finally {
  await admin.auth.admin.deleteUser(pu.user.id);
}

let ok = 0;
const failed = [];
for (const t of targets) {
  const { error } = await admin.auth.admin.updateUserById(t.id, { password: pw });
  if (error) failed.push(`${t.employee_code}: ${error.message}`);
  else ok++;
}
await admin.from("audit_logs").insert({
  actor_id: null, action: "default_password_rotate", table_name: "profiles", record_id: "all", warehouse_id: null,
  new_data: { count: ok, failed: failed.length },
});
console.log(`เปลี่ยนแล้ว ${ok} บัญชี${failed.length ? ` · ไม่สำเร็จ ${failed.length}: ${failed.slice(0, 5).join("; ")}` : ""}`);
console.log("อย่าลืม: แก้ DEFAULT_USER_PASSWORD บน Vercel ให้ตรงกัน แล้ว Redeploy");

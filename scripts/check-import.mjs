// ตรวจผลการย้ายข้อมูลในฐานข้อมูลจริงแบบอ่านอย่างเดียว (แสดงจำนวน ไม่แสดงชื่อพนักงาน)
// ใช้: node scripts/check-import.mjs
import pg from "pg";

process.loadEnvFile(".env.local");
const domain = "@" + (process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "wha.local");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, params) => (await c.query(sql, params)).rows;
const show = (label, v) => console.log(label.padEnd(34), typeof v === "string" ? v : JSON.stringify(v));

show("คลัง", await q("select code, name, checkin_radius_m, latitude is not null as has_gps from public.warehouses order by code"));
show(
  "พนักงาน แยกคลัง/บทบาท/สถานะ",
  await q(`select coalesce(w.code, 'ส่วนกลาง') as wh, p.role, p.status, count(*)::int as n
           from public.profiles p left join public.warehouses w on w.id = p.warehouse_id
           group by 1, 2, 3 order by 1, 2, 3`),
);
show("ต้องตั้งรหัสใหม่", (await q("select count(*)::int as n from public.profiles where must_change_password"))[0].n);
show("บัญชีล็อกอินทั้งหมด", (await q("select count(*)::int as n from auth.users"))[0].n);
show("บัญชีที่ไม่มีข้อมูลพนักงาน", (await q("select count(*)::int as n from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)"))[0].n);
show(
  "อีเมลล็อกอินไม่ตรงรหัสพนักงาน",
  (await q("select count(*)::int as n from public.profiles p join auth.users u on u.id = p.id where u.email <> lower(p.employee_code) || $1", [domain]))[0].n,
);
show(
  "คนลาออก: ถูกปิดล็อกอิน",
  await q("select (u.banned_until > now()) as banned from public.profiles p join auth.users u on u.id = p.id where p.status = 'resigned'"),
);
show("ตัวเลือกตั้งค่า แยกหมวด", await q("select category, count(*)::int as n from public.dropdown_options group by 1 order by 1"));
show("ประวัติการใช้งาน", await q("select action, table_name, count(*)::int as n from public.audit_logs group by 1, 2 order by 1, 2"));

// จำลองการมองเห็นข้อมูลของผู้ใช้จริงบางบทบาท (ทำในรายการทดลองแล้วยกเลิกทุกครั้ง ไม่บันทึกอะไร)
async function seenBy(where) {
  const [u] = await q(`select p.id, p.role, w.code from public.profiles p left join public.warehouses w on w.id = p.warehouse_id where ${where} limit 1`);
  if (!u) return null;
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: u.id, role: "authenticated" }), u.id]);
    await c.query("set local role authenticated");
    const [r] = await q("select count(*)::int as n, count(distinct warehouse_id)::int as whs from public.profiles");
    return `${u.role} ${u.code ?? "ส่วนกลาง"} เห็น ${r.n} คน จาก ${r.whs} คลัง`;
  } finally {
    await c.query("rollback");
  }
}
show("สิทธิ์: แอดมินคลัง 32", await seenBy("p.role = 'admin' and w.code = 'WH32' and p.status = 'active'"));
show("สิทธิ์: แอดมินคลัง 5", await seenBy("p.role = 'admin' and w.code = 'WH5' and p.status = 'active'"));
show("สิทธิ์: พนักงานคลัง 5", await seenBy("p.role = 'employee' and w.code = 'WH5'"));
show("สิทธิ์: แอดมินที่ลาออก", await seenBy("p.status = 'resigned'"));
show("สิทธิ์: ผู้ดูแลระบบสูงสุด", await seenBy("p.role = 'super_admin'"));
await c.end();

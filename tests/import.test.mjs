// ทดสอบการแปลงข้อมูลจากแอปเดิม ด้วยข้อมูลสมมติ (ไม่ใช่ข้อมูลพนักงานจริง)
import { test } from "node:test";
import assert from "node:assert/strict";
import { transform } from "../scripts/lib/lovable-transform.mjs";

const W5 = "aaaaaaaa-0000-0000-0000-000000000005";
const W32 = "aaaaaaaa-0000-0000-0000-000000000032";
const W35 = "aaaaaaaa-0000-0000-0000-000000000035";

const base = { is_deleted: false, status: "active", ot_eligible: true, show_in_ot_report: true, is_warehouse_sriracha: true };
const src = {
  warehouses: [
    { id: W5, code: "WH05", name: "WH5", radius_km: 0.2, color: "#022d74", latitude: 13.5, longitude: 100.7, is_active: true },
    { id: W32, code: "WH32", name: "WH32", radius_km: 0.35, color: null, is_active: true },
    { id: W35, code: "WH35", name: "ศรีราชา", radius_km: 0.2, is_active: true },
  ],
  profiles: [
    { ...base, user_id: "u1", employee_code: "0001", first_name_th: " สมมติ  ", last_name_th: "-", warehouse_id: W5, position: "RT" },
    { ...base, user_id: "u2", employee_code: "0002", first_name_th: "ทดสอบ", warehouse_id: W32, position: "ตำแหน่งใหม่", status: "resigned", resigned_date: "2026-10-01" },
    { ...base, user_id: "u3", employee_code: "0003", first_name_th: "นอกขอบเขต", warehouse_id: W35 },
    { ...base, user_id: "u4", employee_code: "0001", first_name_th: "รหัสซ้ำ", warehouse_id: W32 },
    { ...base, user_id: "u5", employee_code: "รหัสไทย", first_name_th: "x", warehouse_id: W5 },
    { ...base, user_id: "u6", employee_code: "0006", first_name_th: "", warehouse_id: W5 },
    { ...base, user_id: "u7", employee_code: "0007", first_name_th: "หัวหน้า", warehouse_id: W5, health_conditions: "ข้อมูลสุขภาพ", national_id: "1234567890123" },
    { ...base, user_id: "u8", employee_code: "0008", first_name_th: "ลบแล้ว", warehouse_id: W5, is_deleted: true },
  ],
  user_roles: [
    { user_id: "u1", role: "user" },
    { user_id: "u7", role: "user" },
    { user_id: "u7", role: "admin" },
    { user_id: "u2", role: "super_admin" },
  ],
  warehouse_access_permissions: [
    { user_id: "u7", warehouse_id: W5 },
    { user_id: "u7", warehouse_id: W32 },
    { user_id: "u7", warehouse_id: W35 },
  ],
  dropdown_options: [{ id: "o1", category: "position", value: "RT", label: "RT", sort_order: 3, extra: {}, is_active: true }],
};

test("ย้ายเฉพาะคลัง 5 และ 32 พร้อมเปลี่ยนรหัส/ชื่อคลัง", () => {
  const out = transform(src);
  assert.deepEqual(out.warehouses.map((w) => [w.code, w.name, w.checkin_radius_m]), [["WH5", "คลัง 5", 200], ["WH32", "คลัง 32", 350]]);
  assert.equal(out.warehouses[0].id, W5, "ใช้ ID เดิม");
});

test("พนักงาน: ใช้ ID เดิม ตัดช่องว่าง ข้ามรายการที่มีปัญหา และไม่ย้ายข้อมูลอ่อนไหว", () => {
  const out = transform(src);
  assert.deepEqual(out.profiles.map((p) => p.employee_code), ["0001", "0002", "0007"]);
  const p1 = out.profiles[0];
  assert.equal(p1.id, "u1");
  assert.equal(p1.first_name_th, "สมมติ");
  assert.equal(p1.last_name_th, null, "เครื่องหมาย - ถือว่าว่าง");
  assert.equal(out.profiles[1].status, "resigned");
  assert.equal(out.profiles[1].resigned_date, "2026-10-01");
  const p7 = out.profiles[2];
  assert.equal(p7.role, "admin");
  assert.ok(!("health_conditions" in p7) && !("national_id" in p7), "ไม่ย้ายข้อมูลสุขภาพและเลขบัตร");
  assert.deepEqual(out.issues.map((i) => i.type).sort(), ["บทบาทเดิมไม่ได้ย้าย (ไปกำหนดใหม่ในแอป)", "ไม่มีชื่อ", "รหัสพนักงานซ้ำ", "รหัสพนักงานใช้ไม่ได้"].sort());
  assert.equal(out.profiles[1].role, "employee", "super_admin เดิมไม่ถูกย้ายเป็นผู้ดูแล");
});

test("คลังเพิ่มเติม: เก็บเฉพาะคลังในขอบเขตที่ไม่ใช่คลังหลัก", () => {
  assert.deepEqual(transform(src).userWarehouses, [{ user_id: "u7", warehouse_id: W32 }]);
});

test("ตำแหน่งที่ใช้อยู่แต่ไม่มีในรายการ ถูกเพิ่มเข้าตัวเลือก", () => {
  const out = transform(src);
  assert.deepEqual(out.addedPositions, ["ตำแหน่งใหม่"]);
  const added = out.options.find((o) => o.value === "ตำแหน่งใหม่");
  assert.equal(added.category, "position");
  assert.equal(added.sort_order, 4);
  assert.match(added.id, /^[0-9a-f-]{36}$/, "รายการที่เพิ่มต้องมี ID");
  assert.ok(out.options.every((o) => o.id), "ทุกรายการมี ID");
});

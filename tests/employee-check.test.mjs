// ทดสอบการตรวจข้อมูลพนักงานไม่ครบ (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { missingFields, MISSING_KEYS, MISSING_LABEL } from "../src/lib/employee-check.ts";

const full = { first_name_th: "สมมติ", last_name_th: "ทดสอบ", salary_code: "S001", position: "RT", employment_type: "monthly_employee", warehouse_id: "w1", role: "employee" };

test("ข้อมูลครบ = ไม่มีช่องขาด", () => {
  assert.deepEqual(missingFields(full, 2), []);
});

test("ช่องว่างหรือมีแต่ช่องว่าง นับว่าขาด", () => {
  const e = { ...full, last_name_th: "  ", salary_code: null, position: "", employment_type: null, warehouse_id: null };
  assert.deepEqual(missingFields(e, 0), ["last_name", "salary_code", "position", "employment_type", "warehouse", "skill"]);
});

test("ชื่อเต็มอยู่ในช่องชื่อ (เช่น MOU) ไม่นับว่าขาดนามสกุล", () => {
  assert.deepEqual(missingFields({ ...full, first_name_th: "มิน ออง", last_name_th: null }, 1), []);
  assert.deepEqual(missingFields({ ...full, first_name_th: " มิน ", last_name_th: null }, 1), ["last_name"]);
});

test("ผู้ดูแลระบบสูงสุด/ผู้บริหาร ไม่ต้องมีคลัง", () => {
  assert.deepEqual(missingFields({ ...full, warehouse_id: null, role: "super_admin" }, 1), []);
  assert.deepEqual(missingFields({ ...full, salary_code: null, position: null, warehouse_id: null, role: "super_admin" }, 0), [], "บัญชีผู้ดูแลระบบไม่ตรวจ");
  assert.deepEqual(missingFields({ ...full, warehouse_id: null, role: "executive" }, 1), []);
  assert.deepEqual(missingFields({ ...full, warehouse_id: null, role: "admin" }, 1), ["warehouse"]);
});

test("ทุกช่องมีชื่อภาษาไทย", () => {
  for (const k of MISSING_KEYS) assert.ok(MISSING_LABEL[k]);
});

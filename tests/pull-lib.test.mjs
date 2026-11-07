// ทดสอบสูตรตั้งค่า Pull Operation ฝั่งหน้าเว็บ (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { valueAt, nextChange, perShift, readiness, parsePositive, skillStyle, activeTasks } from "../src/lib/pull.ts";

test("ค่าที่ใช้ตามวันที่เริ่มใช้ / ค่าล่วงหน้า", () => {
  const list = [
    { effective_from: "2000-01-01", v: 30 },
    { effective_from: "2026-12-01", v: 25 },
    { effective_from: "2026-11-10", v: 28 },
  ];
  assert.equal(valueAt(list, "2026-11-09").v, 30);
  assert.equal(valueAt(list, "2026-11-10").v, 28);
  assert.equal(valueAt(list, "2027-01-01").v, 25);
  assert.equal(valueAt(list, "1999-12-31"), null, "ยังไม่มีค่า = null ไม่ใช่ 0");
  assert.equal(nextChange(list, "2026-11-09").v, 28);
  assert.equal(nextChange(list, "2026-12-01"), null);
});

test("1 คนทำได้ต่อกะ = Productivity × ชั่วโมง (ตรงตัวอย่างในสไลด์)", () => {
  assert.equal(perShift(25, 8), 200);
  assert.equal(perShift(45, 8), 360);
  assert.equal(perShift(30, 9.5), 285);
  assert.equal(perShift(32.46, 10), 324.6);
  assert.equal(perShift(null, 8), null);
  assert.equal(perShift(30, 0), null);
});

test("ตรวจตัวเลขที่พิมพ์", () => {
  assert.equal(parsePositive("30", 1000), 30);
  assert.equal(parsePositive("1,200.555", 100000), 1200.56);
  assert.equal(parsePositive("0", 1000), null);
  assert.equal(parsePositive("-3", 1000), null);
  assert.equal(parsePositive("abc", 1000), null);
  assert.equal(parsePositive("25", 24), null, "เกินค่าสูงสุด");
});

test("ความพร้อม 4 ขั้น: บอกได้ว่าขาดอะไร", () => {
  const cfg = {
    skillNames: [], skillPositions: {}, counts: [],
    pullSkills: [{ warehouse_id: "w", skill_name: "RT รับ", sort_order: 1 }, { warehouse_id: "w", skill_name: "Checker", sort_order: 2 }],
    types: [
      { id: "t1", warehouse_id: "w", name: "งานรับ", unit: "pallet", sort_order: 1, is_active: true },
      { id: "t2", warehouse_id: "w", name: "งานเก่า", unit: "pallet", sort_order: 2, is_active: false },
      { id: "t3", warehouse_id: "w", name: "งานเติม", unit: "pallet", sort_order: 3, is_active: true },
    ],
    tasks: [
      { id: "k1", warehouse_id: "w", workload_type_id: "t1", skill_name: "RT รับ", is_active: true },
      { id: "k2", warehouse_id: "w", workload_type_id: "t2", skill_name: "Checker", is_active: true },
    ],
    rates: [{ task_id: "k1", warehouse_id: "w", effective_from: "2000-01-01", per_hour: 30, note: null, created_at: "" }],
    hours: [{ warehouse_id: "w", shift: "morning", effective_from: "2000-01-01", hours: 10, note: null, created_at: "" }],
  };
  const r = readiness(cfg, "w", "2026-11-07");
  assert.equal(r.skills, true);
  assert.equal(r.productivity, true, "งานที่ใช้จริงมีค่าครบ (งานในประเภทที่ปิดไม่นับ)");
  assert.deepEqual(r.skillsWithoutTask, ["Checker"], "Checker ผูกกับประเภทงานที่ปิดแล้ว = ยังไม่มีงาน");
  assert.deepEqual(r.typesWithoutSkill, ["งานเติม"]);
  assert.equal(r.mapping, false);
  assert.equal(r.hours, false, "ยังไม่มีชั่วโมงกะดึก");
  assert.deepEqual(activeTasks(cfg, "w").map((k) => k.id), ["k1"]);
  // ทักษะที่ไม่ได้เปิดให้ดึงไม่ถูกนับ
  const noPull = { ...cfg, pullSkills: [] };
  assert.equal(readiness(noPull, "w", "2026-11-07").skills, false);
  assert.equal(activeTasks(noPull, "w").length, 0);
});

test("ไอคอนและสีของทักษะเดาจากชื่อ", () => {
  assert.equal(skillStyle("RT รับ(Domestics)").icon, "forklift");
  assert.equal(skillStyle("RT รับ(Domestics)").color, "#e5484d");
  assert.equal(skillStyle("RT เติม(Domestics)").color, "#1e8e5a");
  assert.equal(skillStyle("เช็ครับ(Export)").icon, "clipboard");
  assert.equal(skillStyle("Picker จ่าย").icon, "cart");
  assert.equal(skillStyle("OP ลากรับ").color, "#7c3aed");
  assert.equal(skillStyle("โหลดงาน").icon, "truck");
  assert.equal(skillStyle("CT4F").icon, "box");
});

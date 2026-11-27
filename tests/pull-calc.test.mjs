// ทดสอบสูตรคำนวณคนที่ต้องการฝั่งหน้าเว็บ ด้วยตัวอย่างชุดเดียวกับเทสต์ฐานข้อมูล (tests/db-pull-workloads.test.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { requirementRows, skillRequirements, totalRequired, ceilPeople } from "../src/lib/pull.ts";
import { PULL_CASES } from "./fixtures/pull-cases.mjs";

// สร้างการตั้งค่าจากตัวอย่าง (คลัง w)
export function cfgFrom(c) {
  const skills = [...new Set(c.tasks.map((t) => t[0]))];
  return {
    skillNames: skills,
    skillPositions: {},
    counts: [],
    pullSkills: skills.map((s, i) => ({ warehouse_id: "w", skill_name: s, sort_order: i + 1 })),
    types: c.types.map((n, i) => ({ id: n, warehouse_id: "w", name: n, unit: "pallet", sort_order: i + 1, is_active: true })),
    tasks: c.tasks.map(([s, t], i) => ({ id: `k${i}`, warehouse_id: "w", workload_type_id: t, skill_name: s, is_active: true })),
    rates: c.tasks.map(([, , r], i) => ({ task_id: `k${i}`, warehouse_id: "w", effective_from: "2000-01-01", per_hour: r, note: null, created_at: "" })),
    hours: ["morning", "night"].map((shift) => ({ warehouse_id: "w", shift, effective_from: "2000-01-01", hours: c.hours, note: null, created_at: "" })),
  };
}

for (const c of PULL_CASES) {
  test(`หน้าเว็บ: ${c.name}`, () => {
    const cfg = cfgFrom(c);
    const reqs = skillRequirements(cfg, "w", requirementRows(cfg, "w", "2026-11-08", "morning", c.volumes));
    assert.deepEqual(Object.fromEntries(reqs.map((r) => [r.skill_name, r.required])), c.expect);
    assert.equal(totalRequired(reqs), c.total);
  });
}

test("หน้าเว็บ: บอกเหตุผลที่ยังคำนวณไม่ได้", () => {
  const c = PULL_CASES[0];
  const cfg = cfgFrom(c);
  cfg.pullSkills.push({ warehouse_id: "w", skill_name: "ทักษะใหม่", sort_order: 9 });
  let reqs = skillRequirements(cfg, "w", requirementRows(cfg, "w", "2026-11-08", "morning", { งานรับ: 400 }));
  const why = Object.fromEntries(reqs.map((r) => [r.skill_name, r.missing]));
  assert.equal(why["RT รับ"], null);
  assert.equal(why["Picker จ่าย"], "ยังไม่กรอกยอดงาน");
  assert.equal(why["ทักษะใหม่"], "ยังไม่ผูกประเภทงาน");
  cfg.hours = [];
  reqs = skillRequirements(cfg, "w", requirementRows(cfg, "w", "2026-11-08", "morning", c.volumes));
  assert.equal(reqs[0].missing, "ยังไม่ตั้งชั่วโมงต่อกะ");
  assert.equal(reqs[0].required, null);
  // ค่า Productivity ที่เริ่มใช้หลังวันนั้นยังไม่นับ
  const late = cfgFrom(c);
  late.rates = late.rates.map((r) => ({ ...r, effective_from: "2026-12-01" }));
  reqs = skillRequirements(late, "w", requirementRows(late, "w", "2026-11-08", "morning", c.volumes));
  assert.equal(reqs[0].missing, "ยังไม่ตั้ง Productivity");
});

test("ปัดขึ้นเสมอ", () => {
  assert.equal(ceilPeople(2), 2);
  assert.equal(ceilPeople(2.0001), 3);
  assert.equal(ceilPeople(0.9999999999999999), 1);
  assert.equal(ceilPeople(0), 0);
});

// ---------- แตกยอดอัตโนมัติ (ชุดเดียวกับ tests/db-pull-splits.test.mjs) ----------
import { effectiveVolumes, inputTypes, splitChildren, readiness } from "../src/lib/pull.ts";
import { SPLIT_CASE } from "./fixtures/pull-cases.mjs";

function splitCfg(from = "2026-11-28") {
  const c = SPLIT_CASE;
  const cfg = cfgFrom({ ...c, types: c.types.map(([n]) => n) });
  cfg.types = c.types.map(([n, unit], i) => ({ id: n, warehouse_id: "w", name: n, unit, sort_order: i + 1, is_active: true }));
  cfg.splits = c.splits.map(([type_id, source_type_id, share_pct, divisor]) => ({ type_id, warehouse_id: "w", effective_from: from, source_type_id, share_pct, divisor, note: null, created_at: "" }));
  return cfg;
}

test("หน้าเว็บ แตกยอด: จ่าย 10,000 ชิ้น → ยอดแต่ละงานและจำนวนคนตรงกับฐานข้อมูล", () => {
  const cfg = splitCfg();
  const vol = effectiveVolumes(cfg, "w", "2026-11-28", SPLIT_CASE.volumes);
  for (const [name, v] of Object.entries(SPLIT_CASE.expectVolumes)) assert.equal(vol[name], v, name);
  assert.equal(vol["ยอดจ่ายรวม"], 10000);
  const reqs = skillRequirements(cfg, "w", requirementRows(cfg, "w", "2026-11-28", "morning", SPLIT_CASE.volumes));
  assert.deepEqual(Object.fromEntries(reqs.map((r) => [r.skill_name, r.required])), SPLIT_CASE.expect);
});

test("หน้าเว็บ แตกยอด: ช่องที่ต้องกรอก ก่อน/หลังวันเริ่มใช้ และยอดหลักไม่ต้องผูกทักษะ", () => {
  const cfg = splitCfg();
  assert.deepEqual(inputTypes(cfg, "w", "2026-11-28").map((t) => t.name), ["งานรับ", "ยอดจ่ายรวม", "งานจ่าย Ecommerce"]);
  assert.equal(inputTypes(cfg, "w", "2026-11-27").length, 8);
  assert.deepEqual(splitChildren(cfg, "ยอดจ่ายรวม", "2026-11-28").map((x) => x.type.name), ["งานจ่าย พาเลทเต็ม", "งานเติม Pickface", "งานจ่าย Picker", "งานโหลดสินค้า", "งานเช็คจ่าย"]);
  // ก่อนวันเริ่มใช้: ใช้ยอดที่กรอกเอง
  const before = effectiveVolumes(cfg, "w", "2026-11-27", { "งานจ่าย พาเลทเต็ม": 70, ยอดจ่ายรวม: 10000 });
  assert.equal(before["งานจ่าย พาเลทเต็ม"], 70);
  assert.equal(before["งานเติม Pickface"], null);
  // ยังไม่กรอกยอดหลัก = ไม่มีค่า (ไม่ตีเป็น 0)
  assert.equal(effectiveVolumes(cfg, "w", "2026-11-28", {})["งานจ่าย Picker"], null);
  assert.deepEqual(readiness(cfg, "w", "2026-11-28").typesWithoutSkill, []);
  assert.deepEqual(readiness(cfg, "w", "2026-11-27").typesWithoutSkill, ["ยอดจ่ายรวม"]);
  // กลับไปกรอกเองตั้งแต่ 1 ธ.ค.
  cfg.splits.push({ type_id: "งานโหลดสินค้า", warehouse_id: "w", effective_from: "2026-12-01", source_type_id: null, share_pct: null, divisor: null, note: null, created_at: "" });
  assert.equal(effectiveVolumes(cfg, "w", "2026-12-01", { งานโหลดสินค้า: 123, ยอดจ่ายรวม: 1 })["งานโหลดสินค้า"], 123);
});

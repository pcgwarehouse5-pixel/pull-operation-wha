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

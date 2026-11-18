// ทดสอบการจัดวางกล่องพนักงานบนแผนที่คลัง 3D อัตโนมัติ
import { test } from "node:test";
import assert from "node:assert/strict";
import { placePeople, skillAnchors, personGap } from "../src/lib/warehouse3d/placement.ts";
import { WAREHOUSE_MAPS } from "../src/lib/warehouse3d/maps.ts";

const MAP = { bounds: [0, 0, 1000, 600], pxm: 5, zones: [{ r: [0, 500, 1000, 100], c: "#fff", t: "UNLOADING AREA" }] };
const S = personGap(MAP); // 25

test("ยังไม่เคยวาง: แต่ละตำแหน่งเรียงตามแนว UNLOADING AREA เป็นกลุ่ม ไม่ทับกัน", () => {
  const ppl = [
    { id: "a", skill: "RT รับ", x: null, y: null },
    { id: "b", skill: "RT รับ", x: null, y: null },
    { id: "c", skill: "Picker", x: null, y: null },
  ];
  const p = placePeople(ppl, {}, MAP);
  // RT รับ กลุ่มแรก จุดกลาง x = 250, Picker กลุ่มที่สอง x = 750 · y = กลางโซน 550
  assert.deepEqual(p.a, { x: 237.5, y: 550, auto: true });
  assert.deepEqual(p.b, { x: 262.5, y: 550, auto: true });
  assert.deepEqual(p.c, { x: 750, y: 550, auto: true });
});

test("วางแล้วอยู่ที่เดิม · คนตำแหน่งเดียวกันที่ยังไม่วางไปอยู่ใกล้คนที่วางแล้ว", () => {
  const ppl = [
    { id: "a", skill: "RT รับ", x: 100, y: 100 },
    { id: "b", skill: "RT รับ", x: null, y: null },
  ];
  const p = placePeople(ppl, { "RT รับ": { x: 900, y: 300 } }, MAP);
  assert.deepEqual(p.a, { x: 100, y: 100, auto: false });
  assert.equal(p.b.auto, true);
  assert.ok(Math.hypot(p.b.x - 100, p.b.y - 100) <= S * 1.5, "อยู่ใกล้คนที่วางแล้ว ไม่ใช่จุดเก่า");
});

test("ลากกลุ่มหนึ่งไปแล้ว กลุ่มอื่นที่ยังวางอัตโนมัติไม่ขยับ (ไม่ไปทับช่องที่ว่าง)", () => {
  const mk = (aX) => [
    { id: "a", skill: "RT รับ", x: aX, y: aX },
    { id: "b", skill: "OP", x: null, y: null },
    { id: "c", skill: "Picker", x: null, y: null },
  ];
  const before = placePeople(mk(null), {}, MAP), after = placePeople(mk(100), {}, MAP);
  assert.deepEqual(after.b, before.b);
  assert.deepEqual(after.c, before.c);
});

test("จุดที่ตำแหน่งนั้นเคยวางล่าสุด: ใช้รอบล่าสุดเท่านั้น และไม่หลุดขอบอาคาร", () => {
  const h = [
    { skill_name: "RT รับ", work_date: "2026-11-17", shift: "night", map_x: 400, map_y: 200, map_at: "2026-11-17T20:00:00Z" },
    { skill_name: "RT รับ", work_date: "2026-11-17", shift: "night", map_x: 420, map_y: 220, map_at: "2026-11-17T20:01:00Z" },
    { skill_name: "RT รับ", work_date: "2026-11-16", shift: "night", map_x: 10, map_y: 10, map_at: "2026-11-16T20:00:00Z" },
    { skill_name: "Picker", work_date: "2026-11-17", shift: "morning", map_x: 995, map_y: 5, map_at: "2026-11-17T08:00:00Z" },
    { skill_name: "Picker", work_date: "2026-11-17", shift: "morning", map_x: null, map_y: null, map_at: null },
  ];
  const a = skillAnchors(h);
  assert.deepEqual(a["RT รับ"], { x: 410, y: 210 });
  assert.deepEqual(a.Picker, { x: 995, y: 5 });
  const p = placePeople([{ id: "x", skill: "Picker", x: null, y: null }], a, MAP);
  assert.deepEqual(p.x, { x: 1000 - S / 2, y: S / 2, auto: true }, "ดันกลับเข้ามาในอาคาร");
});

test("ผัง WH5 / WH32: 30 คน 7 ตำแหน่งวางอัตโนมัติอยู่ในอาคารทั้งหมด", () => {
  for (const key of ["wh5", "wh32"]) {
    const m = WAREHOUSE_MAPS[key];
    const ppl = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, skill: `S${i % 7}`, x: null, y: null }));
    const p = placePeople(ppl, {}, m);
    const [x0, y0, x1, y1] = m.bounds;
    assert.equal(Object.keys(p).length, 30);
    for (const v of Object.values(p)) assert.ok(v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1, key);
    const keys = new Set(Object.values(p).map((v) => `${v.x.toFixed(1)},${v.y.toFixed(1)}`));
    assert.equal(keys.size, 30, `${key}: ไม่มีกล่องทับกัน`);
  }
});

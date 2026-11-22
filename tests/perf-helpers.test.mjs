// ทดสอบตัวช่วยเรื่องความเร็ว: ดึงหลายหน้า จำตัวเลือก แถบโหลด และการไม่วาดตารางซ้ำ (ข้อมูลสมมติ)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPagesFast } from "../src/lib/fetch-pages.ts";
import { createOptionsCache } from "../src/lib/options-cache.ts";
import { navTargetPath } from "../src/lib/nav-progress.ts";
import { cellOf, keepSameMap, keepSameRows, keepSameSet, keyOf, mergeGrid } from "../src/lib/shifts.ts";

const source = (n) => {
  const calls = [];
  let active = 0, peak = 0;
  const page = async (from, to) => {
    calls.push(from);
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 1));
    active--;
    const data = [];
    for (let i = from; i <= to && i < n; i++) data.push(i);
    return { data, error: null };
  };
  return { page, calls, peak: () => peak };
};

test("ดึงหลายหน้า: ได้ครบ เรียงถูก ไม่ซ้ำ ทุกขนาด รวมพอดีหน้าและไม่มีข้อมูล", async () => {
  for (const n of [0, 1, 9, 10, 11, 19, 20, 21, 39, 40, 41, 45, 50, 51, 90]) {
    const s = source(n);
    const got = await fetchPagesFast(s.page, 10, 4);
    assert.deepEqual(got, Array.from({ length: n }, (_, i) => i), `${n} แถว`);
  }
});

test("ดึงหลายหน้า: หน้าแรกไม่เต็มยิงครั้งเดียว และหน้าถัดไปดึงพร้อมกัน", async () => {
  const small = source(7);
  await fetchPagesFast(small.page, 10, 4);
  assert.equal(small.calls.length, 1);
  const big = source(38);
  await fetchPagesFast(big.page, 10, 4);
  assert.ok(big.peak() >= 3, "ดึงพร้อมกัน");
});

test("ดึงหลายหน้า: หน้าใดพังต้องแจ้ง error ไม่คืนข้อมูลขาด", async () => {
  const page = async (from) => (from === 20 ? { data: null, error: new Error("boom") } : { data: Array(10).fill(from), error: null });
  await assert.rejects(fetchPagesFast(page, 10, 4), /boom/);
});

const opt = (category, value, sort_order = 1) => ({ category, value, sort_order });
function fake(rowsRef) {
  const log = [];
  let t = 0;
  const cache = createOptionsCache({
    ttlMs: 100,
    now: () => t,
    sort: (a, b) => a.sort_order - b.sort_order,
    fetcher: async (cats) => {
      log.push(cats.join(","));
      if (rowsRef.fail) throw new Error("offline");
      return rowsRef.rows.filter((r) => cats.includes(r.category));
    },
  });
  return { cache, log, tick: (ms) => (t += ms) };
}

test("จำตัวเลือก: เปลี่ยนหน้าไม่ดึงซ้ำ · เรียงตามลำดับ · เก่าแล้วดึงใหม่ · ข้อมูลเหมือนเดิมใช้รายการเดิม", async () => {
  const ref = { rows: [opt("a", "2", 2), opt("a", "1", 1), opt("b", "x")] };
  const f = fake(ref);
  assert.equal(f.cache.peek(["a"]), null);
  const one = await f.cache.load(["a"]);
  assert.deepEqual(one.a.map((r) => r.value), ["1", "2"]);
  await f.cache.load(["a"]);
  assert.deepEqual(f.log, ["a"], "ยังไม่เก่า ไม่ดึงซ้ำ");
  await f.cache.load(["a", "b"]);
  assert.deepEqual(f.log, ["a", "b"], "ดึงเฉพาะหมวดที่ยังไม่มี");
  f.tick(100);
  const again = await f.cache.load(["a"]);
  assert.equal(f.log.length, 3, "เก่าแล้วดึงใหม่");
  assert.equal(again.a, one.a, "ข้อมูลเหมือนเดิม ใช้รายการเดิม");
  ref.rows = [opt("a", "9"), opt("b", "x")];
  f.tick(100);
  assert.deepEqual((await f.cache.load(["a"])).a.map((r) => r.value), ["9"]);
});

test("จำตัวเลือก: ขอพร้อมกันยิงครั้งเดียว · แก้ค่าแล้วเห็นทันที · เน็ตหลุดคงค่าเดิม", async () => {
  const ref = { rows: [opt("a", "1")] };
  const f = fake(ref);
  await Promise.all([f.cache.load(["a"]), f.cache.load(["a"]), f.cache.load(["a"])]);
  assert.equal(f.log.length, 1);
  ref.rows = [opt("a", "2")];
  f.cache.invalidate();
  assert.deepEqual((await f.cache.load(["a"])).a.map((r) => r.value), ["2"]);
  f.tick(100);
  ref.fail = true;
  assert.deepEqual((await f.cache.load(["a"])).a.map((r) => r.value), ["2"], "ดึงไม่ได้ ใช้ค่าล่าสุด");
  assert.deepEqual((await f.cache.load(["new"])).new, [], "ไม่เคยมีข้อมูล = ว่าง");
});

test("จำตัวเลือก: ผลที่ดึงก่อนแก้ค่า ต้องไม่ทำให้ค่าเก่าถูกถือว่าใหม่", async () => {
  const ref = { rows: [opt("a", "old")] };
  let release;
  const gate = new Promise((r) => (release = r));
  let first = true;
  const cache = createOptionsCache({
    fetcher: async () => {
      if (first) {
        first = false;
        const snapshot = ref.rows;
        await gate;
        return snapshot;
      }
      return ref.rows;
    },
  });
  const slow = cache.load(["a"]);
  ref.rows = [opt("a", "new")];
  cache.invalidate();
  release();
  await slow;
  assert.deepEqual((await cache.load(["a"])).a.map((r) => r.value), ["new"]);
});

test("แถบโหลด: ขึ้นเฉพาะการเปลี่ยนหน้าในแอปแท็บเดิม", () => {
  const now = "https://app.test/shifts?x=1";
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(navTargetPath("/leave", now, click), "/leave");
  assert.equal(navTargetPath("https://app.test/ot", now, click), "/ot");
  assert.equal(navTargetPath("/shifts", now, click), null, "หน้าเดิม");
  assert.equal(navTargetPath("/shifts?y=2", now, click), null, "หน้าเดิม คนละตัวกรอง");
  assert.equal(navTargetPath("#top", now, click), null);
  assert.equal(navTargetPath("https://other.test/a", now, click), null, "เว็บอื่น");
  assert.equal(navTargetPath("mailto:a@b.test", now, click), null);
  assert.equal(navTargetPath("/leave", now, click, "_blank"), null, "แท็บใหม่");
  assert.equal(navTargetPath("/leave", now, click, "", true), null, "ดาวน์โหลด");
  assert.equal(navTargetPath("/leave", now, { ...click, ctrlKey: true }), null);
  assert.equal(navTargetPath("/leave", now, { ...click, button: 1 }), null);
  assert.equal(navTargetPath(null, now, click), null);
});

test("ตาราง: แก้ 1 ช่อง แถวอื่นใช้ของเดิม และไม่แตะข้อมูลต้นฉบับ", () => {
  const base = { a: { "2026-11-01": cellOf("STD1"), "2026-11-02": cellOf("OFF") }, b: { "2026-11-01": cellOf("OFF") } };
  const copy = JSON.stringify(base);
  const g = mergeGrid(base, { [keyOf("a", "2026-11-01")]: cellOf("GN_5"), [keyOf("a", "2026-11-02")]: null, [keyOf("c", "2026-11-01")]: cellOf("OFF") });
  assert.equal(g.b, base.b, "แถวที่ไม่แก้ใช้ของเดิม");
  assert.notEqual(g.a, base.a);
  assert.equal(g.a["2026-11-01"].shift_code, "GN_5");
  assert.equal(g.a["2026-11-02"], undefined, "ลบช่อง");
  assert.equal(g.c["2026-11-01"].shift_code, "OFF", "คนที่ยังไม่มีกะ");
  assert.equal(JSON.stringify(base), copy, "ต้นฉบับไม่เปลี่ยน");
});

test("โหลดซ้ำ: เหมือนเดิมใช้ของเดิม ต่างเฉพาะแถวไหนเปลี่ยนแถวนั้น", () => {
  const prev = { a: { d1: cellOf("STD1") }, b: { d1: cellOf("OFF") } };
  assert.equal(keepSameRows(prev, { a: { d1: cellOf("STD1") }, b: { d1: cellOf("OFF") } }), prev);
  const next = keepSameRows(prev, { a: { d1: cellOf("GN_5") }, b: { d1: cellOf("OFF") } });
  assert.notEqual(next, prev);
  assert.equal(next.b, prev.b);
  assert.equal(next.a.d1.shift_code, "GN_5");
  assert.deepEqual(Object.keys(keepSameRows(prev, { a: prev.a })), ["a"], "คนหายจากตาราง");
  assert.notEqual(keepSameRows(prev, { a: { d1: cellOf("STD1"), d2: cellOf("OFF") }, b: prev.b }).a, prev.a, "มีวันเพิ่ม");
  assert.notEqual(keepSameRows(prev, { a: { d2: cellOf("STD1") }, b: prev.b }).a, prev.a, "คนละวัน");
  const s = new Set(["x"]);
  assert.equal(keepSameSet(s, new Set(["x"])), s);
  assert.notEqual(keepSameSet(s, new Set(["y"])), s);
  const m = new Map([["k", { type: "sick" }]]);
  assert.equal(keepSameMap(m, new Map([["k", { type: "sick" }]])), m);
  assert.notEqual(keepSameMap(m, new Map([["k", { type: "personal" }]])), m);
  assert.notEqual(keepSameMap(m, new Map()), m);
});

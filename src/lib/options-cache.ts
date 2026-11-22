// จำรายการตัวเลือกไว้ในหน้าจอ: เปลี่ยนหน้าแล้วแสดงทันที และดึงใหม่เมื่อเก่าเกินกำหนด (ทดสอบด้วย tests/perf-helpers.test.mjs)
type Entry<T> = { rows: T[]; json: string; at: number };

export function createOptionsCache<T extends { category: string }>(o: {
  fetcher: (categories: string[]) => Promise<T[]>;
  sort?: (a: T, b: T) => number;
  ttlMs?: number;
  now?: () => number;
}) {
  const ttl = o.ttlMs ?? 60_000;
  const now = o.now ?? Date.now;
  const store = new Map<string, Entry<T>>();
  let flying = new Map<string, Promise<void>>();
  let generation = 0;
  const EMPTY: T[] = [];

  const put = (cat: string, rows: T[], at: number) => {
    const list = o.sort ? [...rows].sort(o.sort) : rows;
    const json = JSON.stringify(list);
    const old = store.get(cat);
    // ข้อมูลเหมือนเดิม: ใช้รายการเดิม หน้าจอจะได้ไม่ต้องวาดใหม่
    store.set(cat, { rows: old?.json === json ? old.rows : list, json, at });
  };
  const result = (cats: string[]) => Object.fromEntries(cats.map((c) => [c, store.get(c)?.rows ?? EMPTY])) as Record<string, T[]>;

  return {
    /** ข้อมูลที่จำไว้ (ครบทุกหมวดเท่านั้น) */
    peek(cats: string[]): Record<string, T[]> | null {
      return cats.every((c) => store.has(c)) ? result(cats) : null;
    },
    async load(cats: string[]): Promise<Record<string, T[]>> {
      const t = now();
      const need = cats.filter((c) => {
        const e = store.get(c);
        return !e || t - e.at >= ttl;
      });
      const start = need.filter((c) => !flying.has(c));
      if (start.length) {
        const gen = generation;
        const map = flying;
        const job = o
          .fetcher(start)
          .then((rows) => {
            // มีการแก้ระหว่างดึง: เก็บไว้แสดงได้ แต่ถือว่าเก่า ครั้งต่อไปจะดึงใหม่
            const at = gen === generation ? now() : -Infinity;
            for (const c of start) put(c, rows.filter((r) => r.category === c), at);
          })
          .catch(() => {}) // ดึงไม่ได้: คงข้อมูลเดิมไว้
          .finally(() => start.forEach((c) => map.delete(c)));
        start.forEach((c) => map.set(c, job));
      }
      await Promise.all(need.map((c) => flying.get(c)));
      return result(cats);
    },
    /** เรียกหลังแก้ตัวเลือก: ครั้งต่อไปจะดึงจากฐานข้อมูลใหม่ */
    invalidate() {
      generation++;
      flying = new Map();
      for (const e of store.values()) e.at = -Infinity;
    },
  };
}

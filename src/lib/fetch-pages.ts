// ดึงข้อมูลเกิน 1,000 แถวแบบเร็ว: หน้าแรกก่อน ถ้ายังไม่หมดค่อยดึงหน้าถัดไปพร้อมกันทีละชุด (ทดสอบด้วย tests/perf-helpers.test.mjs)
type Page = (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>;

export async function fetchPagesFast<T>(page: Page, size = 1000, parallel = 4): Promise<T[]> {
  const one = async (n: number) => {
    const { data, error } = await page(n * size, n * size + size - 1);
    if (error) throw error;
    return (data as T[]) ?? [];
  };
  const first = await one(0);
  const out = [...first];
  if (first.length < size) return out;
  for (let n = 1; ; n += parallel) {
    const batch = await Promise.all(Array.from({ length: parallel }, (_, i) => one(n + i)));
    for (const rows of batch) {
      out.push(...rows);
      if (rows.length < size) return out; // หน้านี้ไม่เต็ม = หมดแล้ว หน้าหลังจากนี้ไม่ต้องใช้
    }
  }
}

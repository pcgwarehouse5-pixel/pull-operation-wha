// หาพิกัดคลังจากมือถือให้แม่นที่สุด: เก็บค่า GPS หลายครั้งแล้วเฉลี่ยเฉพาะค่าที่แม่น
// (ค่าแม่นมากมีน้ำหนักมาก: น้ำหนัก = 1 / ความคลาดเคลื่อน²) ทดสอบด้วย tests/geo-fix.test.mjs
export type GeoSample = { lat: number; lng: number; acc: number };
export type GeoFix = { lat: number; lng: number; acc: number; used: number; total: number };

/** ค่าที่ถือว่า "แม่นพอ" จะหยุดจับสัญญาณเองเมื่อได้ค่าแบบนี้หลายครั้ง (เมตร) */
export const GOOD_ACC_M = 10;
/** เกินค่านี้ให้เตือนว่าคลาดเคลื่อนสูง (เมตร) */
export const POOR_ACC_M = 30;

export function bestFix(samples: GeoSample[]): GeoFix | null {
  const ok = samples.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.acc) && s.acc > 0);
  if (!ok.length) return null;
  const best = Math.min(...ok.map((s) => s.acc));
  // ใช้เฉพาะค่าที่ใกล้เคียงค่าที่แม่นที่สุด ตัดค่าตอนเพิ่งเปิด GPS ที่ยังคลาดเคลื่อนมากทิ้ง
  const limit = Math.max(best * 1.5, best + 3);
  const use = ok.filter((s) => s.acc <= limit);
  let w = 0, lat = 0, lng = 0;
  for (const s of use) {
    const k = 1 / (s.acc * s.acc);
    w += k;
    lat += s.lat * k;
    lng += s.lng * k;
  }
  // ความคลาดเคลื่อนของค่าเฉลี่ย ไม่ให้ต่ำกว่าค่าที่แม่นที่สุดที่เครื่องรายงาน (กันตัวเลขดูดีเกินจริง)
  return { lat: lat / w, lng: lng / w, acc: best, used: use.length, total: ok.length };
}

/** หยุดจับสัญญาณได้แล้ว: ได้ค่าแม่นพอ (≤ GOOD_ACC_M) อย่างน้อย 3 ครั้ง */
export function fixIsGood(samples: GeoSample[]): boolean {
  return samples.filter((s) => s.acc <= GOOD_ACC_M).length >= 3;
}

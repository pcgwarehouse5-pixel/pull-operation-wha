// รูปการ์ตูนพนักงานคลัง: หมวกนิรภัย + เสื้อกั๊กสะท้อนแสงสีตามตำแหน่งงาน · สีผิวและเสื้อด้านในต่างกันเล็กน้อยตามคน (ดูไม่ซ้ำกันทั้งแถว)
// ใช้ชุดเดียวกันทั้งการ์ด (React) และป้ายชื่อบนแผนที่ 3D / ภาพที่บันทึก (รูปภาพ data URL)

const SKINS = ["#f3c9a4", "#e8b38a", "#d69a6f", "#f6d2b3"];
const SHIRTS = ["#1b2a5c", "#334155", "#1f4e79", "#3f3f46", "#14532d", "#4c1d95"];
const seedOf = (s: string) => [...s].reduce((n, c) => n + c.charCodeAt(0), 0);
/** รับเฉพาะสีแบบ #rgb / #rrggbb (กันข้อความแปลกปนเข้า SVG) */
const safeColor = (c: string) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) ? c : "#1b2a5c");

/** SVG ของรูปการ์ตูน · id = คำนำหน้าไม่ซ้ำกันในหน้า (ใช้กับ gradient/clip) */
export function workerIconSvg(color: string, seed = "", id = "w", size = 64): string {
  const c = safeColor(color);
  const n = seedOf(seed);
  const skin = SKINS[n % SKINS.length];
  const shirt = SHIRTS[Math.floor(n / SKINS.length) % SHIRTS.length];
  const k = id.replace(/[^a-z0-9_-]/gi, "");
  const vest = "M16.5 66V50.5c0-4 4-6.8 8.6-7.6L32 52.5l6.9-9.6c4.6.8 8.6 3.6 8.6 7.6V66Z";
  const hat = "M20.4 27c0-8.6 5.1-13 11.6-13s11.6 4.4 11.6 13Z";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" style="display:block">`
    + `<defs><clipPath id="${k}c"><circle cx="32" cy="32" r="30.5"/></clipPath>`
    + `<linearGradient id="${k}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${c}" stop-opacity="0.32"/></linearGradient>`
    + `<linearGradient id="${k}hat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>`
    + `<circle cx="32" cy="32" r="30.5" fill="#ffffff"/><circle cx="32" cy="32" r="30.5" fill="url(#${k}bg)"/>`
    + `<g clip-path="url(#${k}c)">`
    + `<path d="M7 66C7 50 17 42.5 32 42.5S57 50 57 66Z" fill="${shirt}"/>`
    + `<path d="${vest}" fill="${c}"/><path d="${vest}" fill="none" stroke="#000" stroke-opacity="0.12" stroke-width="1"/>`
    + `<rect x="16.5" y="56" width="11" height="3.4" rx="1" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.4"/>`
    + `<rect x="36.5" y="56" width="11" height="3.4" rx="1" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.4"/>`
    + `<rect x="28.4" y="35.5" width="7.2" height="9" rx="3.2" fill="${skin}"/>`
    + `<circle cx="21.9" cy="30.5" r="2.3" fill="${skin}"/><circle cx="42.1" cy="30.5" r="2.3" fill="${skin}"/><circle cx="32" cy="29.5" r="10.2" fill="${skin}"/>`
    + `<circle cx="28.2" cy="30.6" r="1.35" fill="#1b2340"/><circle cx="35.8" cy="30.6" r="1.35" fill="#1b2340"/>`
    + `<path d="M28.6 34.2q3.4 2.8 6.8 0" fill="none" stroke="#1b2340" stroke-width="1.4" stroke-linecap="round"/>`
    + `<circle cx="25.6" cy="33.3" r="1.6" fill="#f43f5e" opacity="0.18"/><circle cx="38.4" cy="33.3" r="1.6" fill="#f43f5e" opacity="0.18"/>`
    + `<path d="${hat}" fill="${c}"/><path d="${hat}" fill="url(#${k}hat)"/>`
    + `<rect x="30.4" y="14.2" width="3.2" height="12.8" rx="1.4" fill="#000" opacity="0.12"/>`
    + `<rect x="17.6" y="25.8" width="28.8" height="3.6" rx="1.8" fill="${c}"/><rect x="17.6" y="25.8" width="28.8" height="3.6" rx="1.8" fill="#000" opacity="0.18"/>`
    + `</g><circle cx="32" cy="32" r="30.5" fill="none" stroke="${c}" stroke-width="2.5"/></svg>`;
}

const urls = new Map<string, string>();
/** รูปการ์ตูนเป็นลิงก์รูปภาพ (ใช้ใน <img> และวาดลงภาพที่บันทึก) · จำไว้ ไม่สร้างซ้ำ */
export function workerIconUrl(color: string, seed = ""): string {
  const key = `${color}|${seedOf(seed)}`;
  let u = urls.get(key);
  if (!u) {
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(workerIconSvg(color, seed, "w", 128))}`;
    urls.set(key, u);
  }
  return u;
}

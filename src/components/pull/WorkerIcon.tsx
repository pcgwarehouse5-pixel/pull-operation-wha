"use client";

// ไอคอนพนักงานคลัง: หมวกนิรภัย + เสื้อกั๊กสะท้อนแสงสีตามตำแหน่งงาน · สีผิวและเสื้อด้านในต่างกันเล็กน้อยตามคน (ดูไม่ซ้ำกันทั้งแถว)
import { useId } from "react";

const SKINS = ["#f3c9a4", "#e8b38a", "#d69a6f", "#f6d2b3"];
const SHIRTS = ["#1b2a5c", "#334155", "#1f4e79", "#3f3f46", "#14532d", "#4c1d95"];

const seedOf = (s: string) => [...s].reduce((n, c) => n + c.charCodeAt(0), 0);

export function WorkerIcon({ color, seed = "", size = 64, title }: { color: string; seed?: string; size?: number; title?: string }) {
  const id = useId().replace(/:/g, "");
  const n = seedOf(seed);
  const skin = SKINS[n % SKINS.length];
  const shirt = SHIRTS[Math.floor(n / SKINS.length) % SHIRTS.length];
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="block">
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="32" cy="32" r="30.5" />
        </clipPath>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor={color} stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id={`${id}hat`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30.5" fill={`url(#${id}bg)`} />
      <g clipPath={`url(#${id}c)`}>
        {/* เสื้อด้านใน */}
        <path d="M7 66C7 50 17 42.5 32 42.5S57 50 57 66Z" fill={shirt} />
        {/* เสื้อกั๊กสีตามตำแหน่ง + แถบสะท้อนแสง */}
        <path d="M16.5 66V50.5c0-4 4-6.8 8.6-7.6L32 52.5l6.9-9.6c4.6.8 8.6 3.6 8.6 7.6V66Z" fill={color} />
        <path d="M16.5 66V50.5c0-4 4-6.8 8.6-7.6L32 52.5l6.9-9.6c4.6.8 8.6 3.6 8.6 7.6V66Z" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="1" />
        <rect x="16.5" y="56" width="11" height="3.4" rx="1" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.4" />
        <rect x="36.5" y="56" width="11" height="3.4" rx="1" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.4" />
        {/* คอ หู หน้า */}
        <rect x="28.4" y="35.5" width="7.2" height="9" rx="3.2" fill={skin} />
        <circle cx="21.9" cy="30.5" r="2.3" fill={skin} />
        <circle cx="42.1" cy="30.5" r="2.3" fill={skin} />
        <circle cx="32" cy="29.5" r="10.2" fill={skin} />
        <circle cx="28.2" cy="30.6" r="1.35" fill="#1b2340" />
        <circle cx="35.8" cy="30.6" r="1.35" fill="#1b2340" />
        <path d="M28.6 34.2q3.4 2.8 6.8 0" fill="none" stroke="#1b2340" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="25.6" cy="33.3" r="1.6" fill="#f43f5e" opacity="0.18" />
        <circle cx="38.4" cy="33.3" r="1.6" fill="#f43f5e" opacity="0.18" />
        {/* หมวกนิรภัย */}
        <path d="M20.4 27c0-8.6 5.1-13 11.6-13s11.6 4.4 11.6 13Z" fill={color} />
        <path d="M20.4 27c0-8.6 5.1-13 11.6-13s11.6 4.4 11.6 13Z" fill={`url(#${id}hat)`} />
        <rect x="30.4" y="14.2" width="3.2" height="12.8" rx="1.4" fill="#000" opacity="0.12" />
        <rect x="17.6" y="25.8" width="28.8" height="3.6" rx="1.8" fill={color} />
        <rect x="17.6" y="25.8" width="28.8" height="3.6" rx="1.8" fill="#000" opacity="0.18" />
      </g>
      <circle cx="32" cy="32" r="30.5" fill="none" stroke={color} strokeWidth="2.5" />
    </svg>
  );
}

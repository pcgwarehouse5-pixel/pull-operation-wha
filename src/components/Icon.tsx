// ไอคอนเส้น (วาดเองแบบ SVG ไม่ต้องโหลดไลบรารีเพิ่ม)
const PATHS = {
  home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  users: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M16 4a4 4 0 010 7M18 14a6 6 0 014 7",
  warehouse: "M3 21V9l9-5 9 5v12M7 21v-7h10v7M7 17h10",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  key: "M15 7a4 4 0 11-3.5 6L6 18.5V21H3v-3l5.5-5.5A4 4 0 0115 7zM16 8h.01",
  logout: "M15 17l5-5-5-5M20 12H9M12 20H5a1 1 0 01-1-1V5a1 1 0 011-1h7",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5",
  back: "M15 5l-7 7 7 7",
  calendar: "M4 6a1 1 0 011-1h14a1 1 0 011 1v14H4zM4 10h16M8 3v4M16 3v4",
  tool: "M14.7 6.3a4 4 0 00-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  next: "M9 5l7 7-7 7",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  leave: "M5 4h11l3 3v13H5zM9 12h6M9 16h4M15 4v4h4",
  check: "M5 12l5 5L20 7",
  bell: "M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  ot: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5h4M17 3l3 3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d={PATHS[name]} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

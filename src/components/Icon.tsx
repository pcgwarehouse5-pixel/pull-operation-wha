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
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  cart: "M3 4h2l2.4 11h10.8l2-8H6.2M9 20a1 1 0 100-2 1 1 0 000 2zM18 20a1 1 0 100-2 1 1 0 000 2z",
  clipboard: "M9 3h6v3H9zM8 4.5H6V21h12V4.5h-2M9 11h6M9 15h4",
  forklift: "M3 18V9h6l3 5v4M3 18h9M5.5 20.5a2 2 0 100-4 2 2 0 000 4zM10.5 20.5a2 2 0 100-4 2 2 0 000 4zM12 14h3M15 3v15h6",
  trolley: "M3 4h3l3 12h10M10.5 20.5a2 2 0 100-4 2 2 0 000 4zM17.5 20.5a2 2 0 100-4 2 2 0 000 4zM11 6h7v7h-7z",
  truck: "M2 6h12v10H2zM14 9h4l3 3v4h-7M6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1.5v2M12 20.5v2M4.6 4.6L6 6M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4",
  moon: "M20.5 13.5A8.5 8.5 0 1110.5 3.5a6.8 6.8 0 0010 10z",
  bulb: "M9 18h6M10 21.5h4M12 2.5a6.5 6.5 0 00-3.7 11.9V16h7.4v-1.6A6.5 6.5 0 0012 2.5z",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  arrow: "M4 12h15M13 6l6 6-6 6",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  history: "M3 12a9 9 0 103-6.7M3 4v4h4M12 8v4l3 2",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d={PATHS[name]} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

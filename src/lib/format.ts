// วันที่และเวลาแบบไทย ตามเขตเวลา Asia/Bangkok
const TZ = "Asia/Bangkok";

export function thaiDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

// เวลา HH:MM ตามเวลาไทย
export function thaiTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

// วันที่สั้น เช่น "ศ. 6 พ.ย." จากสตริง YYYY-MM-DD
const DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export function shortDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

export function thaiDate(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

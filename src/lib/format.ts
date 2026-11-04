// วันที่และเวลาแบบไทย ตามเขตเวลา Asia/Bangkok
const TZ = "Asia/Bangkok";

export function thaiDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function thaiDate(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

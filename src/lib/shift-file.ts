// ส่งออก/นำเข้าตารางกะเป็นไฟล์ (CSV / Excel / วางจาก Excel) ทดสอบได้ด้วย tests/shift-file.test.mjs
import { THAI_DAYS_SHORT, weekday, type Cell, type Change, type Grid } from "./shifts.ts";

type Person = { id: string; employee_code: string; first_name_th: string; last_name_th: string | null; nickname: string | null; position: string | null };

/** ช่องในไฟล์: "GN_5" หรือ "GN_5+OFF" (ทำงานวันหยุดประจำสัปดาห์) / "GN_5+HOL" (ทำงานวันนักขัตฤกษ์) */
export function cellText(c: Cell | undefined): string {
  if (!c) return "";
  return c.holiday_work ? `${c.shift_code}+${c.holiday_work}` : c.shift_code;
}

export function exportRows(people: Person[], dates: string[], grid: Grid, isWorking: (code: string) => boolean): string[][] {
  const head = ["รหัสพนักงาน", "ชื่อ", "ชื่อเล่น", "ตำแหน่ง", ...dates.map((d) => String(Number(d.slice(8)))), "วันทำงาน"];
  const dow = ["", "", "", "วัน", ...dates.map((d) => THAI_DAYS_SHORT[weekday(d)]), ""];
  const body = people.map((p) => {
    const row = grid[p.id] ?? {};
    return [
      p.employee_code,
      [p.first_name_th, p.last_name_th].filter(Boolean).join(" "),
      p.nickname ?? "",
      p.position ?? "",
      ...dates.map((d) => cellText(row[d])),
      String(dates.filter((d) => row[d] && isWorking(row[d].shift_code)).length),
    ];
  });
  return [head, dow, ...body];
}

export type ImportResult = {
  changes: Change[];
  people: number;
  problems: string[];
  unknownCodes: string[];
};

const isDayHeader = (v: string) => /^\d{1,2}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 31;

/**
 * อ่านตารางกะจากไฟล์: หาแถวหัวที่มีเลขวันที่ 1, 2, 3 ... และคอลัมน์ "รหัส"
 * ถ้าไม่มีแถวหัว (วางจากแอปเดิม) ถือว่า: รหัส | ชื่อ | แผนก | วันที่ 1 | วันที่ 2 ...
 */
export function parseShiftImport(table: string[][], dates: string[], people: Person[], validCodes: Set<string>, holidayDates: Set<string>): ImportResult {
  const problems: string[] = [];
  const unknown = new Set<string>();
  const changes: Change[] = [];
  const byCode = new Map(people.map((p) => [p.employee_code.trim().toLowerCase(), p]));
  const codeUpper = new Map([...validCodes].map((c) => [c.toUpperCase(), c]));

  let headerIdx = -1;
  let dayCols: number[] = [];
  for (let r = 0; r < Math.min(table.length, 10); r++) {
    const row = table[r];
    const cols: number[] = [];
    row.forEach((v, i) => {
      if (isDayHeader(v ?? "") && Number(v) === cols.length + 1) cols.push(i);
    });
    if (cols.length >= 28) {
      headerIdx = r;
      dayCols = cols;
      break;
    }
  }
  let codeCol = 0;
  let start = 0;
  if (headerIdx >= 0) {
    const h = table[headerIdx];
    const found = h.findIndex((v) => /รหัส|code/i.test(v ?? "") && !/เงินเดือน/.test(v ?? ""));
    codeCol = found >= 0 ? found : 0;
    start = headerIdx + 1;
    // แถวหัวที่ 2 (ชื่อวัน) ไม่ใช่ข้อมูล
  } else {
    dayCols = Array.from({ length: 31 }, (_, i) => i + 3);
  }
  if (dayCols.length < dates.length && headerIdx >= 0) problems.push(`ไฟล์มีวันที่ ${dayCols.length} วัน แต่เดือนนี้มี ${dates.length} วัน`);

  const seen = new Set<string>();
  let count = 0;
  for (let r = start; r < table.length; r++) {
    const row = table[r];
    const code = (row[codeCol] ?? "").trim();
    if (!code || /รหัส|^วัน$/.test(code)) continue;
    const p = byCode.get(code.toLowerCase());
    if (!p) {
      if (row.slice(dayCols[0]).some((v) => (v ?? "").trim())) problems.push(`แถว ${r + 1}: ไม่พบรหัสพนักงาน ${code} ในคลังนี้`);
      continue;
    }
    if (seen.has(p.id)) {
      problems.push(`แถว ${r + 1}: รหัส ${code} ซ้ำในไฟล์ (ใช้แถวแรก)`);
      continue;
    }
    seen.add(p.id);
    count++;
    dates.forEach((d, i) => {
      const col = dayCols[i];
      if (col === undefined) return;
      const raw = (row[col] ?? "").trim();
      if (!raw) return;
      const [left, right] = raw.split("+").map((s) => s.trim());
      const shift = codeUpper.get(left.toUpperCase()) ?? (validCodes.has(left) ? left : null);
      if (!shift) {
        unknown.add(left);
        return;
      }
      let hw: Cell["holiday_work"] = null;
      const flag = (right ?? "").toUpperCase();
      if (flag === "OFF" || flag === "HOL") hw = flag;
      else if (flag.startsWith("OT")) hw = holidayDates.has(d) ? "HOL" : "OFF"; // ไฟล์จากแอปเดิม
      changes.push({ user_id: p.id, work_date: d, cell: { shift_code: shift, holiday_work: hw, is_volunteer: false } });
    });
  }
  const unknownCodes = [...unknown];
  if (unknownCodes.length) problems.push(`ไม่รู้จักรหัสกะ: ${unknownCodes.join(", ")} (เพิ่มในหน้าตั้งค่าตัวเลือก → รหัสกะ ก่อน หรือแก้ในไฟล์)`);
  return { changes, people: count, problems, unknownCodes };
}

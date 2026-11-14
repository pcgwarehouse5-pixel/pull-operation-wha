// ส่งออก/นำเข้าตารางกะเป็นไฟล์ (CSV / Excel / วางจาก Excel) ทดสอบได้ด้วย tests/shift-file.test.mjs
import { THAI_DAYS_SHORT, weekday, type Cell, type Change, type Grid, type ShiftDef } from "./shifts.ts";
import { parseCellText } from "./shift-grid.ts";
import { STYLE, colName, type XSheet } from "./xlsx-write.ts";

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

/** วันลาที่พบในไฟล์ (ไม่ใส่กะ ให้ไปยื่นใบลาในระบบลา) */
export type LeaveCell = { user_id: string; name: string; work_date: string; text: string };

export type ImportResult = {
  changes: Change[];
  people: number;
  problems: string[];
  unknownCodes: string[];
  leaves: LeaveCell[];
  matchedBy: "code" | "name";
};

// คำในไฟล์ตารางผลัดเดิมของหัวหน้า (ตกลงกับผู้ใช้ 11 พ.ย. 2569)
// วันลา: ไม่ใส่กะ แล้วสรุปให้ยื่นใบลาในระบบ (โควตา/เบี้ยขยันจะคิดถูก)
const LEAVE_WORD = /^(ลา.*|ป่วย|กิจ|พักร้อน|พักผ่อน|คลอด|บวช)$/;
// อบรม: นับเป็นวันทำงาน ใช้กะที่เริ่ม 08:00 (ตอนนี้คือ STD1 08:00-17:00)
const TRAINING_WORD = /^(อบรม|training)$/i;
const TRAINING_START = 8 * 60;
const HOUR = /^(\d{1,2})(?:[.:](\d{2}))?$/;

// ชื่อในไฟล์: ตัดคำนำหน้า เว้นวรรคซ้ำ ไม่สนตัวพิมพ์
const normName = (v: string) =>
  v.replace(/^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
function nameKeys(p: Person): string[] {
  const keys = [p.first_name_th, [p.first_name_th, p.last_name_th].filter(Boolean).join(" ")];
  if (p.nickname) keys.push(p.nickname, `${p.first_name_th} (${p.nickname})`);
  return [...new Set(keys.map(normName).filter(Boolean))];
}

/** หากะจากเวลาเข้างาน เช่น 8 → กะที่เริ่ม 08:00 (ต้องมีกะเดียวที่เริ่มเวลานั้น) */
function shiftByStart(min: number, defs: ShiftDef[]): { code?: string; error?: string } {
  const list = defs.filter((d) => d.working && d.start === min);
  const hhmm = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  if (list.length === 1) return { code: list[0].code };
  if (!list.length) return { error: `ไม่มีกะที่เริ่ม ${hhmm}` };
  return { error: `มีหลายกะที่เริ่ม ${hhmm} (${list.map((d) => d.code).join(", ")}) ให้เขียนรหัสกะแทน` };
}

const isDayHeader = (v: string) => /^\d{1,2}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 31;

/**
 * อ่านตารางกะจากไฟล์: หาแถวหัวที่มีเลขวันที่ 1, 2, 3 ... และคอลัมน์ "รหัส"
 * ถ้าไม่มีแถวหัว (วางจากแอปเดิม) ถือว่า: รหัส | ชื่อ | แผนก | วันที่ 1 | วันที่ 2 ...
 * ไม่มีคอลัมน์รหัส → จับคู่ด้วยชื่อ (ชื่อจริง / ชื่อ-สกุล / ชื่อเล่น) เฉพาะคนในตารางที่เปิดอยู่
 * ส่ง defs (กะที่ใช้อยู่) มาด้วย จะอ่านรูปแบบตารางผลัดเดิมได้: เลขเวลาเข้า (8, 20) · ช่วงเวลา (8-17) · หยุด · วันลา · อบรม
 */
export function parseShiftImport(
  table: string[][], dates: string[], people: Person[], validCodes: Set<string>, holidayDates: Set<string>, defs?: ShiftDef[],
): ImportResult {
  const problems: string[] = [];
  const unknown = new Set<string>();
  const changes: Change[] = [];
  const leaves: LeaveCell[] = [];
  const byCode = new Map(people.map((p) => [p.employee_code.trim().toLowerCase(), p]));
  const byName = new Map<string, Person[]>();
  for (const p of people) for (const k of nameKeys(p)) byName.set(k, [...(byName.get(k) ?? []), p]);
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
  let matchedBy: ImportResult["matchedBy"] = "code";
  if (headerIdx >= 0) {
    // หัวคอลัมน์อาจอยู่แถวเดียวกับเลขวันที่ หรือแถวบน (เช่น ช่อง "ชื่อ" ที่รวมเซลล์ 2 แถว)
    const heads = table.slice(Math.max(0, headerIdx - 2), headerIdx + 1);
    const findCol = (ok: (v: string) => boolean) => {
      for (const h of heads) {
        const i = h.findIndex((v, c) => c < dayCols[0] && ok((v ?? "").trim()));
        if (i >= 0) return i;
      }
      return -1;
    };
    const found = findCol((v) => /รหัส|code/i.test(v) && !/เงินเดือน/.test(v));
    if (found >= 0) codeCol = found;
    else {
      const nameCol = findCol((v) => /^(ชื่อ|ชื่อ-?สกุล|ชื่อ-?นามสกุล|ชื่อพนักงาน|name)$/i.test(v));
      matchedBy = "name";
      codeCol = nameCol >= 0 ? nameCol : 0;
    }
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
    if (!code || /รหัส|^วัน$|^ชื่อ$/.test(code)) continue;
    const hasData = row.slice(dayCols[0]).some((v) => (v ?? "").trim());
    let p: Person | undefined;
    if (matchedBy === "code") p = byCode.get(code.toLowerCase());
    else {
      const found = byName.get(normName(code)) ?? [];
      if (found.length > 1) {
        problems.push(`แถว ${r + 1}: ชื่อ "${code}" ตรงกับหลายคน (${found.map((x) => x.employee_code).join(", ")}) ใส่รหัสพนักงานในไฟล์แทน`);
        continue;
      }
      p = found[0];
    }
    if (!p) {
      if (hasData) problems.push(matchedBy === "code" ? `แถว ${r + 1}: ไม่พบรหัสพนักงาน ${code} ในคลังนี้` : `แถว ${r + 1}: ไม่พบชื่อ "${code}" ในตารางนี้ (ข้ามแถวนี้)`);
      continue;
    }
    if (seen.has(p.id)) {
      problems.push(`แถว ${r + 1}: ${matchedBy === "code" ? "รหัส" : "ชื่อ"} ${code} ซ้ำในไฟล์ (ใช้แถวแรก)`);
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
      let shift = codeUpper.get(left.toUpperCase()) ?? (validCodes.has(left) ? left : null);
      if (!shift && defs) {
        if (LEAVE_WORD.test(left)) {
          leaves.push({ user_id: p.id, name: p.nickname ? `${p.first_name_th} (${p.nickname})` : p.first_name_th, work_date: d, text: left });
          return;
        }
        const hm = left.match(HOUR);
        const min = TRAINING_WORD.test(left) ? TRAINING_START : hm && Number(hm[1]) < 24 ? Number(hm[1]) * 60 + Number(hm[2] ?? 0) : null;
        if (min !== null) {
          const got = shiftByStart(min, defs);
          if (got.error) {
            unknown.add(`${left} (${got.error})`);
            return;
          }
          shift = got.code ?? null;
        } else {
          const parsed = parseCellText(left, defs); // ช่วงเวลา 8-17 · ชื่อกะ · หยุด
          if (parsed.ok && parsed.cell) shift = parsed.cell.shift_code;
        }
      }
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
  if (unknownCodes.length) problems.push(`ช่องที่อ่านไม่ได้ (ไม่ได้ใส่): ${unknownCodes.join(" · ")} — เพิ่มรหัสกะในหน้าตั้งค่าตัวเลือก → รหัสกะ หรือแก้ในไฟล์`);
  if (leaves.length) problems.push(`วันลา ${leaves.length} วันไม่ได้ใส่กะ ให้ยื่นใบลาในระบบลา (ดูรายการด้านล่าง)`);
  return { changes, people: count, problems, unknownCodes, leaves, matchedBy };
}

// ---------- แม่แบบตารางผลัด (Excel) ----------
const DOW_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const LEAVE_CHOICES = ["ลา", "ลากิจ", "ป่วย", "พักร้อน", "อบรม"];

/** กะที่พิมพ์เป็นเลขเวลาเข้าได้ (เริ่มชั่วโมงเต็ม และมีกะเดียวที่เริ่มเวลานั้น) เรียงตามเวลา */
export function hourShifts(defs: ShiftDef[]): { hour: number; def: ShiftDef }[] {
  const starts = new Map<number, ShiftDef[]>();
  for (const d of defs) if (d.working && d.start !== null) starts.set(d.start, [...(starts.get(d.start) ?? []), d]);
  return [...starts.entries()]
    .filter(([m, l]) => l.length === 1 && m % 60 === 0)
    .sort((a, b) => a[0] - b[0])
    .map(([m, l]) => ({ hour: m / 60, def: l[0] }));
}

/** ช่องในแม่แบบ: กะที่มีอยู่แสดงเป็นเลขเวลาเข้า (8, 20) ถ้าทำได้ ไม่งั้นเป็นรหัสกะ */
function templateCell(c: Cell | undefined, byHour: Map<string, number>): string | number {
  if (!c) return "";
  const h = byHour.get(c.shift_code);
  const base = h ?? c.shift_code;
  return c.holiday_work ? `${base}+${c.holiday_work}` : base;
}

/**
 * แม่แบบตารางผลัดแบบเดียวกับไฟล์เดิมของหัวหน้า: ชื่อ | วัน (SUN..SAT) | วันที่ 1..N
 * เพิ่มคอลัมน์รหัสพนักงาน (จับคู่คนแม่นกว่าชื่อ) · ใส่กะที่มีอยู่แล้วให้แก้ต่อได้ · มีรายการให้เลือกในช่อง · แผ่นที่ 2 = วิธีกรอก
 */
export function templateSheets(
  people: Person[], dates: string[], defs: ShiftDef[], grid: Grid, title: string,
): XSheet[] {
  const hours = hourShifts(defs);
  const byHour = new Map(hours.map((h) => [h.def.code, h.hour]));
  const weekend = dates.map((d) => [0, 6].includes(weekday(d)));
  const lastCol = colName(3 + dates.length - 1);
  const body = people.map((p) => [
    { v: p.employee_code, s: STYLE.text },
    { v: p.nickname ? `${p.first_name_th} (${p.nickname})` : p.first_name_th, s: STYLE.text },
    { v: p.position ?? "", s: STYLE.text },
    ...dates.map((d, i) => ({ v: templateCell(grid[p.id]?.[d], byHour), s: weekend[i] ? STYLE.cellWeekend : STYLE.cell })),
  ]);
  const main: XSheet = {
    name: "ตารางผลัด",
    rows: [
      [{ v: title, s: STYLE.title }],
      [{ v: "รหัสพนักงาน", s: STYLE.head }, { v: "ชื่อ", s: STYLE.head }, { v: "ตำแหน่ง", s: STYLE.head }, ...dates.map((d, i) => ({ v: DOW_EN[weekday(d)], s: weekend[i] ? STYLE.headWeekend : STYLE.head }))],
      [{ v: "", s: STYLE.head }, { v: "", s: STYLE.head }, { v: "", s: STYLE.head }, ...dates.map((d, i) => ({ v: Number(d.slice(8)), s: weekend[i] ? STYLE.headWeekend : STYLE.head }))],
      ...body,
    ],
    cols: [13, 24, 12, ...dates.map(() => 6.5)],
    merges: ["A2:A3", "B2:B3", "C2:C3"],
    freeze: { cols: 3, rows: 3 },
    lists: [{ range: `D4:${lastCol}${3 + people.length + 30}`, values: [...hours.map((h) => String(h.hour)), "OFF", ...(defs.some((d) => d.code === "OFFC") ? ["OFFC"] : []), ...LEAVE_CHOICES] }],
  };
  const other = defs.filter((d) => !byHour.has(d.code) && !["OFF", "OFFC"].includes(d.code.toUpperCase()));
  const row = (a: string, b: string, s: number = STYLE.wrap) => [{ v: a, s: STYLE.bold }, { v: b, s }];
  const guide: XSheet = {
    name: "วิธีกรอก",
    rows: [
      [{ v: "วิธีกรอกตารางผลัด", s: STYLE.title }],
      [],
      [{ v: "พิมพ์ในช่อง", s: STYLE.head }, { v: "ความหมาย", s: STYLE.head }],
      ...hours.map((h) => row(String(h.hour), `เข้างาน ${String(h.hour).padStart(2, "0")}:00 → รหัสกะ ${h.def.code} (${h.def.label})`)),
      row("OFF", "OFF แดง = วันหยุดประจำสัปดาห์ (ถ้าให้มาทำงาน ใส่ 8+OFF = ได้ OT)"),
      ...(defs.some((d) => d.code === "OFFC") ? [row("OFFC", "OFF เหลือง = วันหยุดที่บริษัทให้พิเศษ (เปลี่ยนเป็นวันทำงาน ไม่ได้ OT)")] : []),
      row("ลา / ลากิจ / ป่วย / พักร้อน", "วันลา: ไม่ใส่กะ ระบบจะสรุปรายชื่อให้ไปยื่นใบลาแทนพนักงานในแอป"),
      row("อบรม", "นับเป็นวันทำงาน ใช้กะที่เริ่ม 08:00"),
      row("8+OFF", "มาทำงานวัน OFF แดง (เลขหน้า + คือเวลาเข้า) = ได้ OT · วันหยุดประจำปีไม่ต้องใส่ +HOL ระบบคิด OT ให้เอง"),
      row("(เว้นว่าง)", "ไม่แก้กะเดิมของวันนั้น"),
      ...other.map((d) => row(d.code, d.label === d.code ? "รหัสกะในแอป" : `รหัสกะในแอป: ${d.label}`)),
      [],
      [{ v: "ข้อควรรู้", s: STYLE.title }],
      [{ v: "• อย่าแก้คอลัมน์รหัสพนักงาน (ใช้จับคู่คน) · ลบแถวคนที่ไม่ต้องการนำเข้าได้ · เพิ่มคนได้โดยใส่รหัสพนักงาน" }],
      [{ v: "• นำเข้า: ตารางกะ → เครื่องมือ → นำเข้าจาก Excel/CSV → ตรวจผล → ใส่ลงตาราง → บันทึก" }],
      [{ v: "• แผ่นงานนี้ไม่ถูกนำเข้า · ใช้แผ่นงาน \"ตารางผลัด\" เป็นแผ่นแรกเสมอ" }],
    ],
    cols: [26, 70],
  };
  return [main, guide];
}

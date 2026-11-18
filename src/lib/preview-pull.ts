// ข้อมูลสมมติสำหรับ "สอนใช้ Pull Operation" (โหมดดูดีไซน์ · โหลดเฉพาะตอน npm run dev ผ่าน preview-data.ts)
//   ค่าตั้งค่า (ประเภทงาน / Productivity / ชั่วโมงต่อกะ / ทักษะที่ดึงได้) ลอกจากเว็บจริงของ WH5 และ WH32 (18/11/2569)
//   พนักงานทั้งหมดเป็นชื่อสมมติ ไม่ใช่ข้อมูลพนักงานจริง
//   ที่กรอก/จอง/ตั้งเวลาพัก เก็บใน sessionStorage ของแท็บนี้ → ทุกหน้าเห็นตรงกัน · ปิดแท็บหรือเปิดลิงก์ที่มี ?pullreset=1 = เริ่มใหม่
//   เรื่องราวตั้งต้น:
//     วันนี้ กะเช้า WH5  = ตัวอย่างที่ทำเสร็จแล้ว (กรอกยอดครบ จองครบ มีเวลาพัก) ไว้โชว์ผลลัพธ์
//     วันนี้ กะดึก WH5   = ว่าง ให้สอนกรอกยอดงาน → ดูผลคำนวณ → จองคน → ผังตำแหน่ง
//     WH32 จองคนไปแล้วบางส่วน (คนของ WH5 บางคนจึงขึ้น "ติดภารกิจ")
import type { WorkloadRow } from "./pull-data";
import type { Booking, PoolPerson, PoolStatus, PullConfig, PullShift } from "./pull";
import { requirementRows, skillRequirements } from "./pull";

const W5 = "preview-wh-5";
const W32 = "preview-wh-32";
const CODE: Record<string, string> = { [W5]: "WH5", [W32]: "WH32" };
const KEY = "wha-demo-pull-v1";
const AT = "2026-11-01T00:00:00Z";

// ---------- ตั้งค่า (ลอกจากเว็บจริง) ----------
const T5 = { recv: "t5-recv", out: "t5-out", fill: "t5-fill", pick: "t5-pick", load: "t5-load", chk: "t5-chk", ecom: "t5-ecom" };
const T32 = { recv: "t32-recv", out: "t32-out", load: "t32-load", chk: "t32-chk" };

export function previewPullConfig(): PullConfig {
  const skillPositions: Record<string, string[]> = {
    "CT โหลด Domestics": ["CT", "CT4F", "RT"], "CT โหลด Export": ["CT", "CT4F", "RT"], CT4F: ["CT", "CT4F", "RT"],
    "OP ลากจ่าย": ["CT", "CT4F", "OP", "Picker Ecommerce"], "OP ลากรับ": ["CT", "CT4F", "OP", "Picker Ecommerce"],
    "Picker Ecommerce": ["OP", "Picker Ecommerce"], "Picker จ่าย": ["CT", "CT4F", "OP", "Picker Ecommerce"],
    "RT จ่าย(Domestics)": ["RT"], "RT จ่าย(Export)": ["RT"], "RT เติม(Domestics)": ["RT"], "RT รับ(Domestics)": ["RT"], "RT รับ(Export)": ["RT"],
    "เช็คจ่าย Ecommerce": ["Checker Dispatch", "Checker Ecommerce", "Checker Receive"], "เช็คจ่าย(Domestics)": ["Checker Dispatch", "Checker Ecommerce", "Checker Receive"],
    "เช็คจ่าย(Export)": ["Checker Dispatch", "Checker Ecommerce", "Checker Receive"], "เช็ครับ(Domestics)": ["Checker Dispatch", "Checker Ecommerce", "Checker Receive"],
    "เช็ครับ(Export)": ["Checker Dispatch", "Checker Ecommerce", "Checker Receive"], โหลดงาน: ["CT4F", "OP", "Picker Ecommerce", "Team Load"],
  };
  const order = (wh: string, names: string[]) => names.map((skill_name, i) => ({ warehouse_id: wh, skill_name, sort_order: i + 1 }));
  const type = (id: string, wh: string, name: string, unit: string, sort_order: number) => ({ id, warehouse_id: wh, name, unit, sort_order, is_active: true });
  const tasks: PullConfig["tasks"] = [];
  const rates: PullConfig["rates"] = [];
  const task = (wh: string, typeId: string, skill: string, ...perHour: [string, number][]) => {
    const id = `k-${typeId}-${skill}`;
    tasks.push({ id, warehouse_id: wh, workload_type_id: typeId, skill_name: skill, is_active: true });
    for (const [effective_from, per_hour] of perHour) rates.push({ task_id: id, warehouse_id: wh, effective_from, per_hour, note: null, created_at: AT });
  };
  const old = "2000-01-01";
  const now = "2026-11-18";
  task(W5, T5.recv, "OP ลากรับ", [old, 32]);
  task(W5, T5.recv, "RT รับ(Domestics)", [old, 30]);
  task(W5, T5.recv, "CT4F", [old, 88]);
  task(W5, T5.recv, "เช็ครับ(Domestics)", [old, 60]);
  task(W5, T5.out, "RT จ่าย(Domestics)", [old, 35]);
  task(W5, T5.out, "OP ลากจ่าย", [old, 38]);
  task(W5, T5.fill, "RT เติม(Domestics)", [old, 18]);
  task(W5, T5.pick, "Picker จ่าย", [old, 180]);
  task(W5, T5.load, "โหลดงาน", [old, 200]);
  task(W5, T5.load, "CT โหลด Domestics", [old, 800]);
  task(W5, T5.chk, "เช็คจ่าย(Domestics)", [old, 700]);
  task(W5, T5.ecom, "Picker Ecommerce", [old, 60], [now, 80]);
  task(W5, T5.ecom, "เช็คจ่าย Ecommerce", [old, 60], [now, 100]);
  task(W32, T32.recv, "OP ลากรับ", [old, 32]);
  task(W32, T32.recv, "RT รับ(Export)", [old, 30]);
  task(W32, T32.recv, "CT4F", [old, 88]);
  task(W32, T32.recv, "เช็ครับ(Export)", [old, 60]);
  task(W32, T32.out, "RT จ่าย(Export)", [old, 35]);
  task(W32, T32.out, "OP ลากจ่าย", [old, 38]);
  task(W32, T32.load, "โหลดงาน", [old, 200]);
  task(W32, T32.load, "CT โหลด Export", [old, 800]);
  task(W32, T32.chk, "เช็คจ่าย(Export)", [old, 700]);
  const hours = (wh: string, before: number, from18: number) =>
    (["morning", "night"] as const).flatMap((shift) => [
      { warehouse_id: wh, shift, effective_from: old, hours: before, note: null, created_at: AT },
      { warehouse_id: wh, shift, effective_from: now, hours: from18, note: null, created_at: AT },
    ]);
  const counts: PullConfig["counts"] = [];
  for (const wh of [W5, W32]) {
    const n = new Map<string, number>();
    for (const p of PEOPLE.filter((x) => x.wh === wh)) for (const s of p.skills) n.set(s, (n.get(s) ?? 0) + 1);
    for (const [skill_name, people] of n) counts.push({ warehouse_id: wh, skill_name, people });
  }
  return {
    skillNames: Object.keys(skillPositions).sort((a, b) => a.localeCompare(b, "th")),
    skillPositions,
    pullSkills: [
      ...order(W5, ["OP ลากรับ", "RT รับ(Domestics)", "CT4F", "เช็ครับ(Domestics)", "RT จ่าย(Domestics)", "OP ลากจ่าย", "RT เติม(Domestics)", "Picker จ่าย", "โหลดงาน", "CT โหลด Domestics", "เช็คจ่าย(Domestics)", "Picker Ecommerce", "เช็คจ่าย Ecommerce"]),
      ...order(W32, ["OP ลากรับ", "RT รับ(Export)", "CT4F", "เช็ครับ(Export)", "RT จ่าย(Export)", "OP ลากจ่าย", "โหลดงาน", "CT โหลด Export", "เช็คจ่าย(Export)"]),
    ],
    types: [
      type(T5.recv, W5, "งานรับ", "pallet", 1), type(T5.out, W5, "งานจ่าย พาเลทเต็ม", "pallet", 2), type(T5.fill, W5, "งานเติม Pickface", "pallet", 3),
      type(T5.pick, W5, "งานจ่าย Picker", "piece", 4), type(T5.load, W5, "งานโหลดสินค้า", "piece", 5), type(T5.chk, W5, "งานเช็คจ่าย", "piece", 6),
      type(T5.ecom, W5, "งานจ่าย Ecommerce", "piece", 7),
      type(T32.recv, W32, "งานรับ Export", "pallet", 1), type(T32.out, W32, "งานจ่าย Export", "pallet", 2), type(T32.load, W32, "งานโหลด Export", "piece", 3),
      type(T32.chk, W32, "งานเช็คจ่าย Export", "piece", 4),
    ],
    tasks,
    rates,
    hours: [...hours(W5, 10, 9.5), ...hours(W32, 9, 9.5)],
    counts,
  };
}

// ---------- พนักงานสมมติ ----------
type Person = { id: string; code: string; name: string; nick: string; pos: string; wh: string; shift: PullShift; start: number; shiftCode: string; skills: string[]; away?: string };
const START: Record<string, number> = { GN_1: 360, STD1: 480, WH_3: 600, STD2: 1020, GN_7: 1140, GN_5: 1200 };
const p = (id: string, name: string, nick: string, pos: string, wh: string, shiftCode: string, skills: string[], away?: string): Person => ({
  id, code: id.toUpperCase(), name, nick, pos, wh, shift: START[shiftCode] >= 360 && START[shiftCode] < 840 ? "morning" : "night", start: START[shiftCode], shiftCode, skills, away,
});
const RR = "RT รับ(Domestics)", RJ = "RT จ่าย(Domestics)", RF = "RT เติม(Domestics)", C4 = "CT4F", CTD = "CT โหลด Domestics", CTE = "CT โหลด Export";
const OR = "OP ลากรับ", OJ = "OP ลากจ่าย", PK = "Picker จ่าย", LD = "โหลดงาน", PE = "Picker Ecommerce";
const CR = "เช็ครับ(Domestics)", CJ = "เช็คจ่าย(Domestics)", CE = "เช็คจ่าย Ecommerce";
const RRX = "RT รับ(Export)", RJX = "RT จ่าย(Export)", CRX = "เช็ครับ(Export)", CJX = "เช็คจ่าย(Export)";

const PEOPLE: Person[] = [
  // WH5 กะดึก (เข้า 20:00 / 19:00 / 17:00)
  p("n501", "สมชาย ใจดี", "ชาย", "RT", W5, "GN_5", [RR, RJ]),
  p("n502", "วีระพงษ์ แสงทอง", "พงษ์", "RT", W5, "GN_5", [RR, RF]),
  p("n503", "ประยุทธ มั่นคง", "ยุทธ", "RT", W5, "GN_5", [RR, C4]),
  p("n504", "อนุชา ทองดี", "ชา", "RT", W5, "GN_5", [RJ, RF]),
  p("n505", "สุรศักดิ์ บุญมา", "ศักดิ์", "RT", W5, "GN_7", [RJ]),
  p("n506", "ธนากร ศรีสุข", "กร", "RT", W5, "GN_5", [RF, RR]),
  p("n507", "เกรียงไกร พูลผล", "ไกร", "CT4F", W5, "GN_5", [C4, CTD]),
  p("n508", "ชาตรี วงศ์ใหญ่", "ตรี", "RT", W5, "GN_5", [RR], "ลา"),
  p("n509", "สมศักดิ์ รักงาน", "ศักดิ์", "OP", W5, "GN_5", [OR, OJ]),
  p("n510", "วิชัย เพชรงาม", "ชัย", "OP", W5, "GN_5", [OR, PK]),
  p("n511", "มานพ สายสุข", "นพ", "OP", W5, "GN_7", [OR]),
  p("n512", "บุญเลิศ คำแก้ว", "เลิศ", "OP", W5, "GN_5", [OJ, LD]),
  p("n513", "สุดารัตน์ ใจงาม", "ดา", "OP", W5, "GN_5", [PK, PE]),
  p("n514", "กาญจนา ศรีวงศ์", "กาญ", "OP", W5, "STD2", [PK]),
  p("n515", "พิมพ์ชนก แก้วใส", "พิมพ์", "Picker Ecommerce", W5, "GN_5", [PE, PK]),
  p("n516", "ณัฐพล สมบูรณ์", "ณัฐ", "Team Load", W5, "GN_5", [LD]),
  p("n517", "อำนาจ ชัยมงคล", "นาจ", "OP", W5, "GN_5", [LD, OR]),
  p("n518", "ศิริพร ทองคำ", "พร", "Picker Ecommerce", W5, "GN_7", [PE]),
  p("n519", "ทองใบ สุขเจริญ", "ใบ", "OP", W5, "GN_5", [OJ]),
  p("n520", "ปราณี ดวงดี", "ณี", "OP", W5, "GN_5", [PK], "วันหยุด (OFF)"),
  p("n521", "สมหมาย แสนดี", "หมาย", "Team Load", W5, "GN_5", [LD]),
  p("n522", "นภาพร จันทร์เพ็ญ", "นภา", "Checker Receive", W5, "GN_5", [CR, CJ]),
  p("n523", "อรุณี มณีวงศ์", "รุณ", "Checker Receive", W5, "GN_5", [CR]),
  p("n524", "จิราพร สีดา", "จิ", "Checker Dispatch", W5, "GN_5", [CJ, CE]),
  p("n525", "วันเพ็ญ พรหมมา", "เพ็ญ", "Checker Ecommerce", W5, "GN_7", [CE]),
  p("n526", "รัตนา บุญส่ง", "นา", "Checker Ecommerce", W5, "GN_5", [CE, CR]),
  p("n527", "ชไมพร อินทร์แก้ว", "ไม", "Checker Dispatch", W5, "GN_5", [CJ]),
  p("n528", "สายสุนีย์ คงมั่น", "นีย์", "Checker Receive", W5, "GN_5", [CR], "ลา"),
  p("n529", "อภิชาติ นาคสุข", "ชาติ", "RT", W5, "GN_5", [CTD, RJ]),
  p("n530", "สุภาพร ศรีใส", "ภา", "Checker Dispatch", W5, "GN_5", [CJ, CE]),
  p("n531", "ไชยา บุญชู", "ยา", "OP", W5, "GN_5", [OR, LD]),
  // WH32 กะดึก (มีทักษะ Domestics ด้วย ดึงมาช่วย WH5 ได้)
  p("n321", "ไพโรจน์ ทองสุข", "โรจน์", "RT", W32, "GN_5", [RRX, RR]),
  p("n322", "สุเมธ ใจกล้า", "เมธ", "RT", W32, "GN_5", [RJX, RJ, RF]),
  p("n323", "ประเสริฐ ดีมาก", "เสริฐ", "RT", W32, "GN_5", [RRX]),
  p("n324", "บรรจง คำดี", "จง", "OP", W32, "GN_5", [OR, OJ]),
  p("n325", "สมพร แก้วมณี", "พร", "Picker Ecommerce", W32, "GN_5", [PE, PK]),
  p("n326", "เอกชัย ศรีทอง", "เอก", "OP", W32, "GN_5", [LD, OJ]),
  p("n327", "มยุรี สุขใจ", "ยุ", "OP", W32, "GN_7", [PK, PE]),
  p("n328", "ลำดวน พรมดี", "ดวน", "Checker Receive", W32, "GN_5", [CRX, CR]),
  p("n329", "ศรีสุดา ใจเย็น", "สุดา", "Checker Dispatch", W32, "GN_5", [CJX, CE]),
  p("n330", "ธีรวัฒน์ มีสุข", "ธีร์", "CT4F", W32, "GN_5", [C4, CTE]),
  p("n331", "วรรณา ทองใบ", "วรรณ", "Picker Ecommerce", W32, "GN_5", [PE]),
  // WH5 กะเช้า (เข้า 08:00 / 06:00 / 10:00)
  p("m501", "สมบัติ ทรัพย์มาก", "บัติ", "RT", W5, "STD1", [RR, RJ]),
  p("m502", "สุริยา แสงจันทร์", "ยา", "RT", W5, "STD1", [RR, RF]),
  p("m503", "ชัยวัฒน์ ปัญญาดี", "วัฒน์", "RT", W5, "GN_1", [RJ, RF]),
  p("m504", "อดิศักดิ์ บุญเรือง", "ดิศ", "RT", W5, "STD1", [RR]),
  p("m505", "ปิยะ ศักดิ์ดี", "ปิ", "CT4F", W5, "STD1", [C4, CTD]),
  p("m506", "สุนทร วงศ์คำ", "ทร", "RT", W5, "WH_3", [RJ, RR]),
  p("m507", "ภานุวัฒน์ ทองมา", "ภา", "OP", W5, "STD1", [OR, OJ]),
  p("m508", "จักรพงษ์ ดำรง", "จักร", "OP", W5, "STD1", [OR, PK]),
  p("m509", "นิพนธ์ สิงห์ทอง", "พนธ์", "OP", W5, "GN_1", [OJ, LD]),
  p("m510", "วาสนา ใจบุญ", "วา", "OP", W5, "STD1", [PK, PE]),
  p("m511", "ละเอียด ศรีมา", "เอียด", "Picker Ecommerce", W5, "STD1", [PE, PK]),
  p("m512", "สมควร ดีงาม", "ควร", "Team Load", W5, "STD1", [LD]),
  p("m513", "ทวีศักดิ์ ใจซื่อ", "ทวี", "Team Load", W5, "WH_3", [LD, OR]),
  p("m514", "บุษบา คำมี", "บุษ", "Picker Ecommerce", W5, "STD1", [PE]),
  p("m515", "สมใจ ทองแท้", "ใจ", "OP", W5, "STD1", [OJ], "ลา"),
  p("m516", "พรทิพย์ ชื่นใจ", "ทิพย์", "Checker Receive", W5, "STD1", [CR, CJ]),
  p("m517", "เยาวลักษณ์ สุขสม", "เยาว์", "Checker Dispatch", W5, "STD1", [CJ, CE]),
  p("m518", "อัญชลี มีชัย", "อัญ", "Checker Ecommerce", W5, "STD1", [CE]),
  p("m519", "ดวงใจ ศรีทอง", "ดวง", "Checker Ecommerce", W5, "WH_3", [CE, CR]),
  p("m520", "กมล สุขสวัสดิ์", "มล", "OP", W5, "STD1", [PK], "วันหยุด (OFF)"),
  p("m521", "สุพจน์ เรืองศรี", "พจน์", "OP", W5, "STD1", [OR, LD]),
  p("m522", "วัชระ พลอยดี", "วัช", "CT4F", W5, "STD1", [CTD, C4]),
  p("m523", "จันทร์เพ็ญ ศรีงาม", "จันทร์", "Checker Dispatch", W5, "STD1", [CJ, CR]),
  // WH32 กะเช้า
  p("m321", "ชูชาติ บุญมี", "ชาติ", "RT", W32, "STD1", [RRX, RR]),
  p("m322", "สมาน ใจตรง", "มาน", "RT", W32, "STD1", [RJX, RJ]),
  p("m323", "ประภาส คงดี", "ภาส", "OP", W32, "STD1", [OR, OJ]),
  p("m324", "นงลักษณ์ ทองเอก", "นง", "Picker Ecommerce", W32, "STD1", [PE, PK]),
  p("m325", "อุไร แสงดาว", "ไร", "Checker Receive", W32, "STD1", [CRX, CR]),
  p("m326", "สมเกียรติ ศรีสม", "เกียรติ", "CT4F", W32, "STD1", [C4, CTE]),
];

// ---------- ที่เก็บของแท็บนี้ ----------
type Store = { workloads: WorkloadRow[]; bookings: Booking[]; seq: number };
let mem: Store | null = null;

function todayBkk(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function store(): Store {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("pullreset")) {
    mem = null;
    try {
      sessionStorage.removeItem(KEY);
      const u = new URL(window.location.href);
      u.searchParams.delete("pullreset");
      window.history.replaceState(null, "", u.toString());
    } catch {}
  }
  if (mem) return mem;
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Store | null;
    if (s && Array.isArray(s.workloads) && Array.isArray(s.bookings)) return (mem = s);
  } catch {}
  mem = seed(todayBkk());
  save();
  return mem;
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(mem));
  } catch {}
}

/** ตั้งต้นใหม่ (ล้างที่กรอก/จองในโหมดตัวอย่าง) */
export function previewResetPull() {
  mem = seed(todayBkk());
  save();
}

/** ตัวเลขยอดงานตัวอย่างสำหรับสอน (ใส่ในคู่มือด้วย) */
export const TRAINING_NIGHT_VOLUMES: Record<string, number> = { [T5.recv]: 800, [T5.out]: 600, [T5.fill]: 300, [T5.pick]: 5000, [T5.load]: 5000, [T5.chk]: 12000, [T5.ecom]: 2000 };
const MORNING_VOLUMES: Record<string, number> = { [T5.recv]: 550, [T5.out]: 650, [T5.fill]: 160, [T5.pick]: 3200, [T5.load]: 3500, [T5.chk]: 6000, [T5.ecom]: 1400 };
const W32_VOLUMES: Record<string, number> = { [T32.recv]: 300, [T32.out]: 250, [T32.load]: 2000, [T32.chk]: 3000 };

function seed(today: string): Store {
  const s: Store = { workloads: [], bookings: [], seq: 0 };
  const put = (wh: string, shift: PullShift, vols: Record<string, number>) => {
    for (const [workload_type_id, volume] of Object.entries(vols)) s.workloads.push({ warehouse_id: wh, work_date: today, shift, workload_type_id, volume });
  };
  put(W5, "morning", MORNING_VOLUMES);
  put(W32, "morning", W32_VOLUMES);
  put(W32, "night", W32_VOLUMES);
  const add = (to: string, shift: PullShift, userId: string, skill: string, brk: string | null, at: string) => {
    const u = PEOPLE.find((x) => x.id === userId)!;
    s.bookings.push({ id: `db${++s.seq}`, work_date: today, shift, user_id: userId, from_warehouse_id: u.wh, to_warehouse_id: to, skill_name: skill, status: "booked", break_time: brk, booked_at: at });
  };
  // WH32 จองไปก่อนแล้ว (คนของ WH5 ที่ถูกจอง จะขึ้น "ติดภารกิจ" ในมุมของ WH5)
  add(W32, "night", "n519", OJ, null, `${today}T10:10:00Z`);
  add(W32, "night", "n323", RRX, null, `${today}T10:11:00Z`);
  add(W32, "night", "n330", C4, null, `${today}T10:12:00Z`);
  add(W32, "morning", "m521", OR, "12:00:00", `${today}T00:05:00Z`);
  add(W32, "morning", "m321", RRX, "12:00:00", `${today}T00:05:00Z`);
  // WH5 กะเช้าวันนี้: จองครบทุกตำแหน่งแล้ว (ตัวอย่างผลลัพธ์)
  const cfg = previewPullConfig();
  const reqs = skillRequirements(cfg, W5, requirementRows(cfg, W5, today, "morning", MORNING_VOLUMES));
  const breaks = ["11:00:00", "12:00:00", "13:00:00"];
  let n = 0;
  for (const r of reqs) {
    for (let i = 0; i < (r.required ?? 0); i++) {
      const used = new Set(s.bookings.filter((b) => b.work_date === today).map((b) => b.user_id));
      const cand = PEOPLE.filter((x) => x.shift === "morning" && !x.away && !used.has(x.id) && x.skills.includes(r.skill_name)).sort(
        (a, b) => Number(a.wh !== W5) - Number(b.wh !== W5) || a.skills.length - b.skills.length,
      )[0];
      if (!cand) break;
      add(W5, "morning", cand.id, r.skill_name, breaks[n++ % breaks.length], `${today}T00:${String(10 + n).padStart(2, "0")}:00Z`);
    }
  }
  return s;
}

// ---------- ฟังก์ชันที่หน้า Pull เรียก ----------
export function previewPullWorkloads(): WorkloadRow[] {
  return store().workloads;
}

export function previewSavePullWorkloads(wh: string, date: string, shift: PullShift, items: { type_id: string; volume: number | null }[]) {
  const s = store();
  s.workloads = [
    ...s.workloads.filter((r) => !(r.warehouse_id === wh && r.work_date === date && r.shift === shift)),
    ...items.filter((i) => i.volume !== null).map((i) => ({ warehouse_id: wh, work_date: date, shift, workload_type_id: i.type_id, volume: i.volume! })),
  ];
  save();
}

/** คลังกลาง (มุมมองของคลังปลายทาง) ณ วัน/กะ · คิดสถานะเหมือนฐานข้อมูลจริง */
export function previewPullPool(wh: string, date: string, shift: PullShift): PoolPerson[] {
  const booked = new Map(store().bookings.filter((b) => b.work_date === date && b.status === "booked").map((b) => [b.user_id, b]));
  return PEOPLE.map((x) => {
    const b = booked.get(x.id);
    const same = b?.shift === shift;
    const status: PoolStatus = b ? (!same ? "unavailable" : b.to_warehouse_id === wh ? "booked_here" : "busy") : x.away || x.shift !== shift ? "unavailable" : "ready";
    const reason = b
      ? !same
        ? `จอง${b.shift === "morning" ? "กะเช้า" : "กะดึก"}แล้ว · ${CODE[b.to_warehouse_id]}`
        : b.to_warehouse_id === wh
          ? "จองเข้าคลังนี้แล้ว"
          : `ถูกจองโดย ${CODE[b.to_warehouse_id]}`
      : x.away ?? (x.shift !== shift ? (shift === "morning" ? "เข้ากะดึก" : "เข้ากะเช้า") : null);
    return {
      user_id: x.id, employee_code: x.code, name: x.name, nickname: x.nick, emp_position: x.pos,
      warehouse_id: x.wh, warehouse_code: CODE[x.wh], shift_code: x.away === "วันหยุด (OFF)" ? "OFF" : x.shiftCode, start_min: x.away === "วันหยุด (OFF)" ? null : x.start,
      status, reason, skills: x.skills,
      booking_id: b?.id ?? null, booked_to: b?.to_warehouse_id ?? null, booked_to_code: b ? CODE[b.to_warehouse_id] : null, booked_skill: b?.skill_name ?? null,
    };
  });
}

export function previewPullBookings(wh: string, date: string, shift: PullShift): Booking[] {
  return store().bookings.filter((b) => b.to_warehouse_id === wh && b.work_date === date && b.shift === shift && b.status === "booked");
}

/** จอง (กันจองซ้ำเหมือนของจริง: 1 คน 1 คลังต่อวัน · ต้องพร้อมและมีทักษะ) */
export function previewBookPull(wh: string, date: string, shift: PullShift, userIds: string[], skill: string) {
  const s = store();
  const conflicts: { user_id: string; name?: string; reason: string }[] = [];
  let booked = 0;
  for (const id of userIds) {
    const person = previewPullPool(wh, date, shift).find((x) => x.user_id === id);
    if (!person) conflicts.push({ user_id: id, reason: "ไม่อยู่ในคลังกลาง" });
    else if (!person.skills.includes(skill)) conflicts.push({ user_id: id, name: person.name, reason: `ไม่มีทักษะ ${skill}` });
    else if (person.status !== "ready") conflicts.push({ user_id: id, name: person.name, reason: person.reason ?? "ไม่พร้อม" });
    else {
      s.bookings.push({ id: `db${++s.seq}`, work_date: date, shift, user_id: id, from_warehouse_id: person.warehouse_id, to_warehouse_id: wh, skill_name: skill, status: "booked", break_time: null, booked_at: new Date().toISOString() });
      booked++;
    }
  }
  save();
  return { booked, conflicts };
}

export function previewCancelPull(id: string) {
  const s = store();
  s.bookings = s.bookings.map((b) => (b.id === id ? { ...b, status: "cancelled" as const } : b));
  save();
}

export function previewSetPullBreak(id: string, time: string | null) {
  const s = store();
  s.bookings = s.bookings.map((b) => (b.id === id ? { ...b, break_time: time ? `${time}:00` : null } : b));
  save();
}

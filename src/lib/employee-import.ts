// ตรวจข้อมูลพนักงานจากไฟล์ Excel/CSV ก่อนนำเข้า (ไม่แตะฐานข้อมูล ทดสอบได้ด้วย tests/employee-import.test.mjs)

export type ImportField =
  | "employee_code"
  | "salary_code"
  | "title"
  | "first_name_th"
  | "last_name_th"
  | "nickname"
  | "position"
  | "department"
  | "employment_type"
  | "subcontractor_company"
  | "phone";

// หัวคอลัมน์ของแม่แบบ (ลำดับนี้ = ลำดับในไฟล์ที่ดาวน์โหลด)
export const TEMPLATE_COLUMNS: { field: ImportField; header: string; required?: boolean; example: string }[] = [
  { field: "employee_code", header: "รหัสพนักงาน", required: true, example: "0012345" },
  { field: "title", header: "คำนำหน้า", example: "นาย" },
  { field: "first_name_th", header: "ชื่อ", required: true, example: "สมชาย" },
  { field: "last_name_th", header: "นามสกุล", example: "ใจดี" },
  { field: "nickname", header: "ชื่อเล่น", example: "ชาย" },
  { field: "position", header: "ตำแหน่ง", example: "RT" },
  { field: "employment_type", header: "ประเภทพนักงาน", example: "พนักงานรายเดือน" },
  { field: "department", header: "แผนก", example: "" },
  { field: "subcontractor_company", header: "บริษัทรับเหมา", example: "" },
  { field: "salary_code", header: "รหัสเงินเดือน", example: "" },
  { field: "phone", header: "เบอร์โทร", example: "" },
];

// จับคู่หัวคอลัมน์ (รับได้ทั้งแม่แบบของแอปนี้ และไฟล์ส่งออกของแอปเดิม) ลำดับการเช็กสำคัญ
export function headerToField(h: string): ImportField | null {
  const t = h.replace(/\s+/g, "").toLowerCase();
  if (!t) return null;
  if (t.includes("รหัสผ่าน") || t.includes("password")) return null; // ไม่รับรหัสผ่านจากไฟล์
  if (t.includes("เงินเดือน") || t.includes("salary")) return "salary_code";
  if (t.includes("คำนำหน้า") || t === "title") return "title";
  if (t.includes("ชื่อเล่น") || t.includes("nick")) return "nickname";
  if (t.includes("นามสกุล") || t.includes("last")) return "last_name_th";
  if (t.includes("รับเหมา") || t.includes("subcontract") || t.includes("บริษัท")) return "subcontractor_company";
  if (t.includes("ประเภท") || t.includes("employment")) return "employment_type";
  if (t.includes("ชื่อ") || t.includes("first")) return "first_name_th";
  if (t.includes("รหัส") || t.includes("code")) return "employee_code";
  if (t.includes("ตำแหน่ง") || t.includes("position")) return "position";
  if (t.includes("แผนก") || t.includes("department")) return "department";
  if (t.includes("เบอร์") || t.includes("phone") || t.includes("โทร")) return "phone";
  return null;
}

export type Existing = { warehouse_id: string | null; manageable: boolean };

export type ImportRow = {
  line: number; // เลขแถวในไฟล์ (นับหัวคอลัมน์เป็นแถว 1)
  data: Partial<Record<ImportField, string>>;
  action: "create" | "update" | "skip";
  errors: string[];
  warnings: string[];
};

export type ImportContext = {
  warehouseId: string;
  positions: string[];
  employmentTypes: { value: string; label: string }[];
  existing: Map<string, Existing>; // key = รหัสพนักงานตัวพิมพ์เล็ก
  updateExisting: boolean;
};

const CODE_RE = /^[A-Za-z0-9._-]{1,30}$/;
const TITLES = ["นาย", "นาง", "นางสาว"];

export function parseImport(table: string[][], ctx: ImportContext) {
  if (table.length < 2) return { rows: [] as ImportRow[], unknownHeaders: [] as string[], missingColumns: ["ไม่มีข้อมูลในไฟล์"] };
  const header = table[0];
  const fields = header.map(headerToField);
  const unknownHeaders = header.filter((h, i) => h.trim() && !fields[i]);
  const missingColumns = TEMPLATE_COLUMNS.filter((c) => c.required && !fields.includes(c.field)).map((c) => c.header);
  if (missingColumns.length) return { rows: [] as ImportRow[], unknownHeaders, missingColumns };

  const seen = new Set<string>();
  const posSet = new Set(ctx.positions);
  const rows: ImportRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const data: Partial<Record<ImportField, string>> = {};
    fields.forEach((f, c) => {
      const v = (cells[c] ?? "").replace(/\s+/g, " ").trim();
      if (f && v && v !== "-") data[f] = v;
    });
    const errors: string[] = [];
    const warnings: string[] = [];
    const code = data.employee_code ?? "";
    if (!code) errors.push("ไม่มีรหัสพนักงาน");
    else if (!CODE_RE.test(code)) errors.push("รหัสพนักงานใช้ได้เฉพาะ A-Z a-z 0-9 . _ -");
    else if (seen.has(code.toLowerCase())) errors.push("รหัสพนักงานซ้ำในไฟล์");
    if (code) seen.add(code.toLowerCase());
    if (!data.first_name_th) errors.push("ไม่มีชื่อ");

    if (data.title && !TITLES.includes(data.title)) warnings.push(`คำนำหน้า "${data.title}" ไม่ใช่ นาย/นาง/นางสาว`);
    if (data.position && !posSet.has(data.position)) warnings.push(`ตำแหน่ง "${data.position}" ยังไม่มีในรายการตั้งค่า`);
    if (data.employment_type) {
      const t = ctx.employmentTypes.find((x) => x.value === data.employment_type || x.label === data.employment_type);
      if (t) data.employment_type = t.value;
      else warnings.push(`ประเภทพนักงาน "${data.employment_type}" ไม่มีในรายการ (บันทึกตามที่กรอก)`);
    }
    if (data.phone && !/^[0-9+\- ]{6,20}$/.test(data.phone)) {
      warnings.push("เบอร์โทรรูปแบบไม่ถูกต้อง (ไม่บันทึกเบอร์)");
      delete data.phone;
    }

    let action: ImportRow["action"] = "create";
    const ex = code ? ctx.existing.get(code.toLowerCase()) : undefined;
    if (ex) {
      if (!ex.manageable) errors.push("รหัสนี้เป็นพนักงานของคลังที่คุณไม่มีสิทธิ์จัดการ");
      else if (!ctx.updateExisting) action = "skip";
      else {
        action = "update";
        if (ex.warehouse_id !== ctx.warehouseId) warnings.push("พนักงานคนนี้อยู่คลังอื่น จะอัปเดตข้อมูลแต่ไม่ย้ายคลัง");
      }
    }
    rows.push({ line: i + 2, data, action: errors.length ? "skip" : action, errors, warnings });
  });
  return { rows, unknownHeaders, missingColumns };
}

export function summarize(rows: ImportRow[]) {
  return {
    create: rows.filter((r) => !r.errors.length && r.action === "create").length,
    update: rows.filter((r) => !r.errors.length && r.action === "update").length,
    skip: rows.filter((r) => !r.errors.length && r.action === "skip").length,
    error: rows.filter((r) => r.errors.length).length,
    warning: rows.filter((r) => r.warnings.length).length,
  };
}

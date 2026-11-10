// สร้างไฟล์ Excel (.xlsx) แบบง่ายโดยไม่ใช้ไลบรารีภายนอก (ทดสอบด้วย tests/shift-template.test.mjs)
// รองรับ: หลายแผ่นงาน, ข้อความ/ตัวเลข, รูปแบบเซลล์ชุดที่กำหนดไว้ (STYLE), ความกว้างคอลัมน์, รวมเซลล์, ตรึงแถว/คอลัมน์,
// รายการให้เลือกในช่อง (data validation) · ไฟล์ zip แบบไม่บีบอัด (Excel เปิดได้ปกติ)

// รูปแบบเซลล์ (ลำดับต้องตรงกับ cellXfs ใน stylesXml)
export const STYLE = {
  normal: 0,
  head: 1, // หัวตาราง: ตัวหนา ขาวบนกรมท่า
  headWeekend: 2, // หัววันเสาร์-อาทิตย์: ตัวหนา แดงบนชมพูอ่อน
  text: 3, // ข้อความในตาราง มีเส้นขอบ
  cell: 4, // ช่องกะ: กึ่งกลาง มีเส้นขอบ
  cellWeekend: 5, // ช่องกะวันเสาร์-อาทิตย์: พื้นชมพูอ่อน
  title: 6, // หัวข้อ: ตัวหนา ใหญ่
  wrap: 7, // ข้อความยาว ตัดบรรทัด
  bold: 8,
} as const;

export type XCell = string | number | null | { v: string | number; s?: number };
export type XSheet = {
  name: string;
  rows: XCell[][];
  cols?: number[]; // ความกว้างคอลัมน์ (หน่วยตัวอักษร)
  merges?: string[]; // เช่น "A1:A2"
  freeze?: { cols: number; rows: number };
  lists?: { range: string; values: string[] }[]; // รายการให้เลือก (พิมพ์ค่าอื่นได้ มีข้อความเตือน)
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(sh: XSheet): string {
  const rows = sh.rows
    .map((row, r) => {
      const cells = row
        .map((c, i) => {
          if (c === null || c === "") return "";
          const v = typeof c === "object" ? c.v : c;
          const s = typeof c === "object" && c.s ? ` s="${c.s}"` : "";
          const ref = `${colName(i)}${r + 1}`;
          if (v === "" ) return s ? `<c r="${ref}"${s}/>` : "";
          return typeof v === "number"
            ? `<c r="${ref}"${s}><v>${v}</v></c>`
            : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const pane = sh.freeze
    ? `<pane xSplit="${sh.freeze.cols}" ySplit="${sh.freeze.rows}" topLeftCell="${colName(sh.freeze.cols)}${sh.freeze.rows + 1}" activePane="bottomRight" state="frozen"/>`
    : "";
  const cols = sh.cols?.length ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  const lists = sh.lists?.length
    ? `<dataValidations count="${sh.lists.length}">${sh.lists
        .map(
          (l) =>
            `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="information" errorTitle="ค่านี้ไม่อยู่ในรายการ" error="ถ้าเป็นรหัสกะที่มีในแอป กด ตกลง ได้เลย" sqref="${l.range}"><formula1>"${esc(l.values.join(","))}"</formula1></dataValidation>`,
        )
        .join("")}</dataValidations>`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>` +
    `${cols}<sheetData>${rows}</sheetData>${merges}${lists}` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>`
  );
}

const stylesXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="5"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFB4232F"/><name val="Tahoma"/></font><font><b/><sz val="14"/><color rgb="FF1B2A5C"/><name val="Tahoma"/></font>` +
  `<font><b/><sz val="11"/><name val="Tahoma"/></font></fonts>` +
  `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF1B2A5C"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFFCE6E7"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFFFF7F7"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left style="thin"><color rgb="FFC8CFDD"/></left><right style="thin"><color rgb="FFC8CFDD"/></right><top style="thin"><color rgb="FFC8CFDD"/></top><bottom style="thin"><color rgb="FFC8CFDD"/></bottom><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="9">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
  `<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// ---------- zip แบบไม่บีบอัด ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // ชื่อไฟล์เป็น UTF-8
    head.setUint16(8, 0, true); // ไม่บีบอัด
    head.setUint16(10, 0, true);
    head.setUint16(12, 0x21, true); // 1 ม.ค. 1980
    head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true);
    head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    parts.push(new Uint8Array(head.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(12, 0, true);
    cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

/** สร้างไฟล์ .xlsx จากแผ่นงาน (แผ่นแรก = sheet1.xml ซึ่งตัวอ่านของแอปใช้) */
export function buildXlsx(sheets: XSheet[]): Uint8Array {
  const enc = new TextEncoder();
  const n = sheets.length;
  const files = [
    {
      name: "[Content_Types].xml",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", xml: stylesXml },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s) })),
  ];
  return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })));
}

/** ให้เบราว์เซอร์ดาวน์โหลดไฟล์ .xlsx */
export function downloadXlsx(filename: string, sheets: XSheet[]) {
  const blob = new Blob([buildXlsx(sheets) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

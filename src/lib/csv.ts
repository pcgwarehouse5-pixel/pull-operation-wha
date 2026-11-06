// สร้าง/อ่านไฟล์ CSV (เปิดด้วย Excel ได้ ภาษาไทยไม่เพี้ยน)

// กันสูตร Excel อันตราย: ค่าที่ขึ้นต้นด้วย = + - @ (และ tab/CR) จะถูกใส่ ' นำหน้าให้เป็นข้อความ
export function safeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function quote(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// แถวแรกคือหัวคอลัมน์ ใส่ BOM ให้ Excel รู้ว่าเป็น UTF-8
export function toCsv(rows: unknown[][]): string {
  return "﻿" + rows.map((r) => r.map((c) => quote(safeCell(c))).join(",")).join("\r\n") + "\r\n";
}

// อ่าน CSV เป็นตาราง (รองรับเครื่องหมายคำพูด, ขึ้นบรรทัดในช่อง, คั่นด้วย , หรือ tab)
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ดาวน์โหลดไฟล์จากเบราว์เซอร์
export function downloadCsv(filename: string, rows: unknown[][]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

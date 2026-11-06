// อ่านแผ่นงานแรกของไฟล์ Excel (.xlsx) เป็นตาราง โดยไม่ใช้ไลบรารีภายนอก
// ไฟล์ .xlsx คือ zip ที่ข้างในเป็น XML: แตก zip ด้วย DecompressionStream ที่มีในเบราว์เซอร์/Node แล้วอ่าน XML
// รองรับ: ข้อความ, ตัวเลข, ข้อความในเซลล์ (inline), ช่องว่างข้ามคอลัมน์ / ไม่รองรับ: สูตรที่ยังไม่คำนวณ, หลายแผ่นงาน

type Entry = { name: string; method: number; size: number; offset: number };

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function listEntries(b: Uint8Array): Entry[] {
  // หา "End of central directory" จากท้ายไฟล์
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ไม่ใช่ไฟล์ Excel (.xlsx) หรือไฟล์เสีย");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error("ไฟล์ Excel เสีย");
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const offset = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(b: Uint8Array, e: Entry): Promise<string> {
  const h = e.offset;
  if (u32(b, h) !== 0x04034b50) throw new Error("ไฟล์ Excel เสีย");
  const start = h + 30 + u16(b, h + 26) + u16(b, h + 28);
  const data = b.subarray(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error("รูปแบบการบีบอัดไฟล์ไม่รองรับ");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// รวมข้อความทุกช่วงใน <si> หรือ <is> (ข้อความที่มีหลายรูปแบบตัวอักษร)
function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = listEntries(b);
  const find = (re: RegExp) => entries.find((e) => re.test(e.name));
  const sheet = find(/^xl\/worksheets\/sheet1\.xml$/) ?? find(/^xl\/worksheets\/sheet\d+\.xml$/);
  if (!sheet) throw new Error("ไม่พบแผ่นงานในไฟล์ Excel");
  const sstEntry = find(/^xl\/sharedStrings\.xml$/);
  const shared = sstEntry ? [...(await readEntry(b, sstEntry)).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const xml = await readEntry(b, sheet);

  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const idx = ref ? colIndex(ref) : next;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = "";
      if (type === "s" && v !== undefined) val = shared[Number(v)] ?? "";
      else if (type === "inlineStr") val = textOf(body);
      else if (v !== undefined) val = unescapeXml(v);
      while (row.length < idx) row.push("");
      row[idx] = val;
      next = idx + 1;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

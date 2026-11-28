"use client";

// แบบฟอร์มหน้าร้าน (A4 แนวนอน): แบบฟอร์มลางานรายคน · แบบแจ้งตารางการปฏิบัติงานพนักงาน
// หน้าตาตามไฟล์ตัวอย่างของผู้ใช้ (แบบฟอร์มลางาน.xlsx / 11.SETกะ พฤศจิกายน.pdf) · ข้อความหัวฟอร์มแก้ได้ที่หน้าตั้งค่า
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sarabun } from "next/font/google";
import { FORM_TYPES, THAI_MONTHS, isSunday, num, thaiDmy, type LeaveFormSheet, type LeaveFormTexts, type ShiftFormTexts } from "@/lib/shop-forms";

const sarabun = Sarabun({ subsets: ["thai", "latin"], weight: ["400", "700"], variable: "--font-ts", display: "swap" });
const W = 1123; // A4 แนวนอนที่ 96 dpi
const H = 794;

export type ShopPerson = {
  id: string;
  employee_code: string;
  title: string | null;
  first_name_th: string;
  last_name_th: string | null;
  position: string | null;
  department: string | null;
  hire_date: string | null;
};

export const fullName = (p: Pick<ShopPerson, "title" | "first_name_th" | "last_name_th">) =>
  [p.title, p.first_name_th, p.last_name_th].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");

/** พิมพ์: ต่อหน้าทั้งหมดท้าย body แล้วซ่อนส่วนอื่นของแอประหว่างพิมพ์ (ใช้กลไกเดียวกับใบลงเวลา) */
export function usePrintPortal(): [boolean, () => void, (pages: ReactNode) => ReactNode] {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("ts-printing");
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => {
      document.fonts.ready.then(() => window.print());
    }, 200);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
      document.body.classList.remove("ts-printing");
    };
  }, [printing]);
  const portal = (pages: ReactNode) => (printing ? createPortal(<div className={`ts-print-root ${sarabun.variable}`}>{pages}</div>, document.body) : null);
  return [printing, () => setPrinting(true), portal];
}

/** แสดงหน้า A4 แนวนอนย่อให้พอดีความกว้างจอ */
export function LandscapeScaled({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`w-full ${sarabun.variable}`}>
      <div className="overflow-hidden rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.12)] ring-1 ring-line" style={{ width: W * scale, height: H * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: W }}>{children}</div>
      </div>
    </div>
  );
}

// ---------------- แบบฟอร์มลางาน ----------------

const LEAVE_ROWS = 19; // จำนวนแถวในแบบฟอร์มเดิม
const TYPE_HEAD: Record<(typeof FORM_TYPES)[number], string> = { sick: "ป่วย", personal: "กิจ", vacation: "พักผ่อน" };
const cellNum = (n: number) => (n ? num(n) : "");

/** แบบฟอร์มลางาน 1 คน (ใบลาเกิน 19 ใบ ตารางยาวต่อหน้าถัดไป) */
export function LeaveFormPage({ person, sheet, year, texts }: { person: ShopPerson; sheet: LeaveFormSheet; year: number; texts: LeaveFormTexts }) {
  const lines = [...sheet.lines, ...Array.from({ length: Math.max(0, LEAVE_ROWS - sheet.lines.length) }, () => null)];
  // ความกว้างคอลัมน์ตามไฟล์ Excel (หน่วยตัวอักษร)
  const cols = [30, 7.5, 7.5, 7.5, 7.5, 7.5, 7.8, 10.5, 36, 19.2, 19.2];
  const sum = cols.reduce((s, c) => s + c, 0);
  return (
    <div className="shop-page" style={{ height: "auto", minHeight: "210mm" }}>
      <table className="shop-tbl" style={{ fontSize: "10pt" }}>
        <colgroup>
          {cols.map((c, i) => (
            <col key={i} style={{ width: `${(c / sum) * 100}%` }} />
          ))}
        </colgroup>
        <tbody>
          <tr style={{ height: "9mm" }}>
            <td className="shop-l" style={{ fontWeight: 700 }}>{texts.group}</td>
            <td colSpan={8} style={{ fontWeight: 700, fontSize: "14pt" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4mm" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- โลโก้บนฟอร์มพิมพ์ ขนาดคงที่ */}
                <img src="/pcg-logo.png" alt="" style={{ height: "7mm" }} />
                {texts.title}
              </span>
            </td>
            <td colSpan={2} className="shop-l">บริษัท : {texts.company}</td>
          </tr>
          <tr style={{ height: "7mm" }}>
            <td className="shop-l">ชื่อ: {fullName(person)}</td>
            <td colSpan={8} className="shop-l">ตำแหน่ง : {person.position ?? ""}</td>
            <td colSpan={2} className="shop-l">สังกัด : {person.department || texts.dept}</td>
          </tr>
          <tr style={{ height: "7mm" }}>
            <td className="shop-l">ประจำปี {year + 543}</td>
            <td colSpan={7} className="shop-l">วันที่เริ่มงาน {thaiDmy(person.hire_date)}</td>
            <td className="shop-l">สิทธิลาพักผ่อนประจำปี {sheet.quota === null ? "-" : num(Number(sheet.quota))} วัน</td>
            <td colSpan={2} className="shop-l">รหัสพนักงาน : {person.employee_code}</td>
          </tr>
          <tr style={{ height: "7mm" }}>
            <td rowSpan={2}>วัน/เดือน/ปี</td>
            <td colSpan={6}>ประเภทการลา/ขาดงาน</td>
            <td rowSpan={2} className="shop-wrap">สิทธิลาพักผ่อนคงเหลือ</td>
            <td rowSpan={2}>เหตุผลการลางาน</td>
            <td rowSpan={2}>ลายเซ็นพนักงาน</td>
            <td rowSpan={2}>ลายเซ็นผู้อนุมัติ</td>
          </tr>
          <tr style={{ height: "7mm" }}>
            {FORM_TYPES.map((t) => [<td key={t}>{TYPE_HEAD[t]}</td>, <td key={`${t}h`}>ชม.</td>])}
          </tr>
          {lines.map((l, i) => (
            <tr key={i} style={{ height: "6.6mm" }}>
              <td>{l?.date ?? ""}</td>
              {FORM_TYPES.map((t) => [
                <td key={t}>{cellNum(l?.cells[t]?.days ?? 0)}</td>,
                <td key={`${t}h`}>{cellNum(l?.cells[t]?.hours ?? 0)}</td>,
              ])}
              <td style={{ fontSize: "8.5pt" }}>{l?.vacationLeft ?? ""}</td>
              <td className="shop-l shop-wrap" style={{ fontSize: "9pt" }}>{l?.reason ?? ""}</td>
              <td />
              <td style={{ fontSize: "8.5pt" }}>{l?.approver ?? ""}</td>
            </tr>
          ))}
          <tr style={{ height: "7mm", fontWeight: 700 }}>
            <td>รวม</td>
            {FORM_TYPES.map((t) => [
              <td key={t}>{cellNum(sheet.totals[t].days)}</td>,
              <td key={`${t}h`}>{cellNum(sheet.totals[t].hours)}</td>,
            ])}
            <td colSpan={4} />
          </tr>
        </tbody>
      </table>
      <p style={{ marginTop: "2mm", fontSize: "8pt" }}>พิมพ์จากแอป WHA Workforce · นับเฉพาะใบลาที่อนุมัติแล้ว · ช่องลายเซ็นผู้อนุมัติแสดงชื่อผู้อนุมัติในแอป</p>
    </div>
  );
}

// ---------------- แบบแจ้งตารางการปฏิบัติงานพนักงาน ----------------

export type ShiftPlanRow = { person: ShopPerson; cells: string[] };

const PLAN_ROWS = 14; // คนต่อหน้า (แถวสูงพอให้เซ็นชื่อ)

/** ใบแจ้งตารางการปฏิบัติงาน ทั้งเดือน (14 คนต่อหน้า · ลายเซ็นผู้บังคับบัญชาทุกหน้า) */
export function ShiftPlanPages({ ym, days, rows, texts }: { ym: string; days: string[]; rows: ShiftPlanRow[]; texts: ShiftFormTexts }) {
  const pages: ShiftPlanRow[][] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += PLAN_ROWS) pages.push(rows.slice(i, i + PLAN_ROWS));
  const [y, m] = ym.split("-").map(Number);
  return (
    <>
      {pages.map((list, pi) => (
        <div key={pi} className="shop-page" style={{ fontSize: "9.5pt", position: "relative" }}>
          <p style={{ position: "absolute", right: "10mm", top: "5mm", fontSize: "8.5pt" }}>หน้าที่ {pi + 1}/{pages.length}</p>
          <div style={{ border: "1px solid #000", padding: "1.2mm 0", textAlign: "center", fontWeight: 700, fontSize: "13pt" }}>{texts.company}</div>
          <p style={{ textAlign: "center", fontWeight: 700, fontSize: "12pt", marginTop: "1.5mm" }}>{texts.title}</p>
          <p style={{ textAlign: "center", marginTop: "1mm" }}>
            ประจำเดือน&nbsp;&nbsp;&nbsp;<b>{THAI_MONTHS[m - 1]}</b>&nbsp;&nbsp;&nbsp;พ.ศ.&nbsp;&nbsp;&nbsp;{y + 543}
          </p>
          <p style={{ marginTop: "2mm", marginBottom: "1.5mm" }}>
            กลุ่มธุรกิจ :&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<b>{texts.group}</b>
          </p>
          <table className="shop-tbl">
            <colgroup>
              <col style={{ width: "4.2%" }} />
              <col style={{ width: "16.5%" }} />
              <col style={{ width: "7.3%" }} />
              {days.map((d) => (
                <col key={d} style={{ width: `${56 / days.length}%` }} />
              ))}
              <col style={{ width: "16%" }} />
            </colgroup>
            <thead>
              <tr style={{ height: "6mm" }}>
                <th rowSpan={2}>ลำดับ</th>
                <th rowSpan={2}>ชื่อ - นามสกุล</th>
                <th rowSpan={2}>วันที่เริ่มงาน</th>
                <th colSpan={days.length}>วันที่</th>
                <th rowSpan={2}>พนักงานเซ็นรับทราบ</th>
              </tr>
              <tr style={{ height: "5.5mm" }}>
                {days.map((d) => (
                  <th key={d} className={isSunday(d) ? "shop-sun" : ""} style={{ padding: 0 }}>{Number(d.slice(8))}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...list, ...Array.from({ length: PLAN_ROWS - list.length }, () => null)].map((r, i) => (
                <tr key={r?.person.id ?? `e${i}`} style={{ height: "8.2mm" }}>
                  <td>{r ? pi * PLAN_ROWS + i + 1 : ""}</td>
                  <td className="shop-l">{r ? fullName(r.person) : ""}</td>
                  <td>{r ? thaiDmy(r.person.hire_date) : ""}</td>
                  {days.map((d, j) => (
                    <td key={d} className={isSunday(d) ? "shop-sun" : ""} style={{ padding: 0 }}>{r?.cells[j] ?? ""}</td>
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "4mm" }}>
            <div style={{ fontSize: "8.5pt", maxWidth: "55%" }}>
              <p style={{ fontWeight: 700 }}>หมายเหตุ :</p>
              <p style={{ marginTop: "1.5mm", whiteSpace: "pre-wrap" }}>{texts.legend}</p>
            </div>
            <div style={{ width: "38%", fontSize: "9.5pt" }}>
              <p style={{ display: "flex", gap: "2mm" }}>
                <span>ลงนาม</span>
                <span style={{ flex: 1, borderBottom: "1px dotted #000" }} />
                <span>{texts.signer_role}</span>
              </p>
              <p style={{ textAlign: "center", marginTop: "2mm" }}>(&nbsp;&nbsp;&nbsp;&nbsp;{texts.signer_name}&nbsp;&nbsp;&nbsp;&nbsp;)</p>
              <p style={{ display: "flex", gap: "2mm", marginTop: "2mm" }}>
                <span>ตำแหน่ง</span>
                <span style={{ flex: 1, borderBottom: "1px dotted #000", textAlign: "center" }}>{texts.signer_title}</span>
              </p>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}


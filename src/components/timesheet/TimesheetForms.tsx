// ใบลงเวลาขนาด A4 ตามฟอร์มบริษัท (ตำแหน่ง/ขนาดช่องวัดจากฟอร์มตัวอย่าง หน่วย มม.)
//   MouForm  = "แบบฟอร์มการบันทึกเวลาปฏิบัติงาน และ แบบขออนุมัติทำงานล่วงเวลา คนงาน" (ครึ่งเดือน)
//   ThaiForm = "แบบฟอร์มการบันทึกเวลาปฏิบัติงาน และ แบบขออนุมัติทำงานล่วงเวลา ทำงานวันหยุด และล่วงเวลาวันหยุด" (เต็มเดือน)
// ใช้ทั้งพรีวิวบนจอและตอนพิมพ์ (คลาส ts-* อยู่ใน globals.css)
import type { CSSProperties, ReactNode } from "react";
import { MOU_RATES, dmy, hhmm, hrs, periodLabel, personName, rateText, totals, type TimesheetForm, type TsDay, type WhTexts } from "@/lib/timesheet";

export type TsPerson = {
  id: string;
  employee_code: string;
  title: string | null;
  first_name_th: string;
  last_name_th: string | null;
  position: string | null;
  salary_code: string | null;
  employment_type: string | null;
};

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const mm = (n: number) => `${n}mm`;
/** ความกว้างคอลัมน์ตามสัดส่วนที่วัดจากฟอร์มตัวอย่าง (มม.) → เปอร์เซ็นต์ของความกว้างตาราง */
const cols = (w: number[]) => {
  const total = w.reduce((s, x) => s + x, 0);
  return (
    <colgroup>
      {w.map((x, i) => (
        <col key={i} style={{ width: `${(x / total) * 100}%` }} />
      ))}
    </colgroup>
  );
};

/** ช่องเติมข้อความแบบมีเส้นใต้ */
function Blank({ w, children, dotted, bold, center = true, style }: { w: number; children?: ReactNode; dotted?: boolean; bold?: boolean; center?: boolean; style?: CSSProperties }) {
  return (
    <span
      className="ts-blank"
      style={{ width: mm(w), borderBottom: `${dotted ? "1px dotted" : "0.8px solid"} #000`, fontWeight: bold ? 700 : undefined, textAlign: center ? "center" : "left", ...style }}
    >
      {children || " "}
    </span>
  );
}

// ---------------------------------------------------------------- MOU
const MOU_W = [20.8, 19.6, 21.7, 18.5, 9.8, 9.8, 9.8, 9.8, 18.5, 28.1, 29.6];

export function MouForm({ person, rows, form, wh }: { person: TsPerson; rows: TsDay[]; form: TimesheetForm; wh: WhTexts }) {
  const sum = totals(rows);
  const f = form.mou;
  return (
    <section className="ts-page ts-mou" aria-label={`ใบลงเวลา ${personName(person)}`}>
      <div style={{ height: mm(14) }} />
      <p className="ts-c ts-b" style={{ fontSize: "11.5pt", lineHeight: mm(7.5) }}>{f.company}</p>
      <p className="ts-c ts-b" style={{ fontSize: "11pt", lineHeight: mm(7.5), marginBottom: mm(2.5) }}>{f.title}</p>

      <div style={{ border: "1px solid #000", height: mm(39.5), padding: `${mm(2.2)} ${mm(1.8)} 0`, position: "relative" }}>
        <div className="ts-row" style={{ height: mm(6.8) }}>
          <span style={{ width: mm(19.6) }}>เรื่อง</span>
          <span>{f.subject}</span>
        </div>
        <div className="ts-row" style={{ height: mm(6.8) }}>
          <span style={{ width: mm(19.6) }}>เรียน</span>
          <span>{f.to}</span>
        </div>
        <div className="ts-row" style={{ height: mm(9), alignItems: "flex-end", paddingLeft: mm(23) }}>
          <span>เนื่องด้วย ทางฝ่าย/แผนก</span>
          <Blank w={47} bold style={{ marginLeft: mm(1.5) }}>{wh.mou_dept}</Blank>
          <span style={{ margin: `0 ${mm(2.5)} 0 ${mm(3.5)}` }}>UL</span>
          <Blank w={16}>{wh.mou_ul}</Blank>
          <span style={{ marginLeft: mm(4.5) }}>ได้ว่าจ้าง แรงงานจ้างเหมา มาทำงาน</span>
        </div>
        <div className="ts-row" style={{ height: mm(8), alignItems: "flex-end", paddingLeft: mm(14.5) }}>
          <span>เวลาปกติ และ ทำงานวันหยุดใน ประจำงวดวันที่</span>
          <Blank w={45} style={{ marginLeft: mm(1) }}>{periodLabel(rows.map((r) => r.date))}</Blank>
          <span style={{ marginLeft: mm(1) }}>จึงขอส่งรายชื่อค่าแรง คนงาน ดังต่อไปนี้</span>
        </div>
      </div>

      <div className="ts-row" style={{ height: mm(10), paddingLeft: mm(1.8) }}>
        <span style={{ width: mm(30) }}>ชื่อ - สกุล :</span>
        <span className="ts-b" style={{ width: mm(84) }}>{personName(person)}</span>
        <span style={{ width: mm(31) }}>รหัสพนักงาน :</span>
        <span>{person.employee_code}</span>
      </div>

      <table className="ts-tbl" style={{ marginTop: mm(3.5) }}>
        {cols(MOU_W)}
        <thead>
          <tr style={{ height: mm(7.3) }}>
            <th rowSpan={2} className="ts-b">วันที่</th>
            <th rowSpan={2} className="ts-b">เวลาเข้า</th>
            <th rowSpan={2} className="ts-b">เวลาออก</th>
            <th className="ts-b" style={{ borderBottom: "none" }}>จำนวนแรง</th>
            <th colSpan={4} className="ts-b">รวม OT. (ชั่วโมง)</th>
            <th className="ts-b" style={{ borderBottom: "none" }}>ลายเซ็น</th>
            <th className="ts-b" style={{ borderBottom: "none" }}>ลายเซ็นรับทราบ</th>
            <th rowSpan={2} className="ts-b">หมายเหตุ</th>
          </tr>
          <tr style={{ height: mm(7.3) }}>
            <th className="ts-b" style={{ borderTop: "none" }}>วันทำงาน</th>
            {MOU_RATES.map((r) => (
              <th key={r} style={{ fontWeight: 400 }}>{r}</th>
            ))}
            <th className="ts-b" style={{ borderTop: "none" }}>พนักงาน</th>
            <th className="ts-b" style={{ borderTop: "none" }}>(หัวหน้างาน)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className={r.off ? "ts-off-mou" : undefined} style={{ height: mm(7.3) }}>
              <td>{dmy(r.date)}</td>
              <td>{hhmm(r.inAt)}</td>
              <td>{hhmm(r.outAt)}</td>
              <td>{hrs(r.workUnits)}</td>
              {MOU_RATES.map((k) => (
                <td key={k}>{hrs(r.byRate.get(k))}</td>
              ))}
              <td />
              <td />
              <td className="ts-remark">{r.remark}</td>
            </tr>
          ))}
          <tr style={{ height: mm(8) }}>
            <td className="ts-none" />
            <td className="ts-none" style={{ borderRight: "1px solid #000" }} />
            <td className="ts-b">รวม (ชั่วโมง)</td>
            <td>{hrs(sum.units)}</td>
            {MOU_RATES.map((k) => (
              <td key={k}>{hrs(sum.byRate.get(k))}</td>
            ))}
            <td className="ts-none" style={{ borderLeft: "1px solid #000" }} colSpan={3} />
          </tr>
        </tbody>
      </table>

      <table className="ts-tbl ts-foot" style={{ marginTop: mm(6) }}>
        {cols([20, 79.5, 38.4, 58.1])}
        <tbody>
          <tr style={{ height: mm(27.4) }}>
            <td>บุคคล</td>
            <td style={{ textAlign: "left", verticalAlign: "top", padding: `${mm(1)} ${mm(1)}`, lineHeight: mm(6.2) }}>
              <div>หมายเหตุ</div>
              {f.notes.map((n, i) => (
                <div key={i}>
                  {i + 1}. {n}
                </div>
              ))}
            </td>
            <td style={{ verticalAlign: "top" }}>
              <div style={{ margin: `${mm(11.5)} auto 0`, width: "75%", borderTop: "0.8px solid #000" }} />
              <div style={{ marginTop: mm(3) }}>หัวหน้างาน</div>
              <div style={{ marginTop: mm(1.2) }}>ผู้ตรวจสอบ</div>
            </td>
            <td style={{ verticalAlign: "top" }}>
              <div style={{ margin: `${mm(11.5)} auto 0`, width: "55%", borderTop: "0.8px solid #000" }} />
              <div style={{ marginTop: mm(3) }}>(ระดับ ผจก.แผนก ขึ้นไป)</div>
              <div style={{ marginTop: mm(1.2) }}>ผู้อนุมัติ</div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------- คนไทย
const THAI_W = [10.7, 11.1, 12, 11.1, 10.7, 60.8, 15.6, 16.7, 16, 14.9, 16.4];
/** ความสูงแถวรายวัน: 30 วัน ≈ ฟอร์มตัวอย่าง (6.15 มม.) · 31 วันบีบเล็กน้อยให้พอดี 1 แผ่น */
const rowH = (n: number) => Math.min(6.2, 184.5 / Math.max(n, 1));

export function ThaiForm({ person, rows, ym, form, wh, rates }: { person: TsPerson; rows: TsDay[]; ym: string; form: TimesheetForm; wh: WhTexts; rates: { workday: number | null; holiday_normal: number | null; holiday_ot: number | null } }) {
  const sum = totals(rows);
  const f = form.thai;
  const [y, m] = ym.split("-").map(Number);
  const name = personName(person);
  const ROW = rowH(rows.length);
  return (
    <section className="ts-page ts-thai" aria-label={`ใบลงเวลา ${name}`}>
      <div style={{ border: "1px solid #000" }}>
        <p className="ts-c ts-b" style={{ height: mm(7.9), lineHeight: mm(7.9), fontSize: "12pt", borderBottom: "1px solid #000" }}>{f.company}</p>
        <p className="ts-c" style={{ height: mm(7.2), lineHeight: mm(7.2), fontSize: "10.5pt", borderBottom: "1px solid #000" }}>{f.title}</p>

        <div className="ts-row" style={{ height: mm(7.5), alignItems: "flex-end", fontSize: "9.5pt" }}>
          <span>ชื่อ-นามสกุล :</span>
          <Blank w={46} dotted center={false}>{name}</Blank>
          <span>รหัสเงินเดือน :</span>
          <Blank w={13.5} dotted>{person.salary_code}</Blank>
          <span>รหัสพนักงาน :</span>
          <Blank w={15} dotted>{person.employee_code}</Blank>
          <span>ประจำเดือน :</span>
          <Blank w={21} dotted>{THAI_MONTHS[m - 1]}</Blank>
          <span>พ.ศ.</span>
          <Blank w={11} dotted>{y + 543}</Blank>
        </div>
        <div className="ts-row" style={{ height: mm(6.4), alignItems: "flex-end", fontSize: "9.5pt", paddingBottom: mm(0.8) }}>
          <span>ตำแหน่ง :</span>
          <Blank w={63} dotted center={false}>{person.position}</Blank>
          <span>สังกัดแผนก/ฝ่าย :</span>
          <Blank w={66} dotted center={false}>{wh.thai_dept}</Blank>
          <span>UL :</span>
          <Blank w={17} dotted>{wh.thai_ul}</Blank>
        </div>

        <table className="ts-tbl ts-inner">
          {cols(THAI_W)}
          <thead>
            <tr style={{ height: mm(6.6) }}>
              <th rowSpan={3}>วันที่</th>
              <th colSpan={2} rowSpan={2}>ช่วงเวลาที่ทำงานปกติ</th>
              <th colSpan={5}>พนักงานยินยอมปฏิบัติงานนอกเวลาทำงานปกติ</th>
              <th colSpan={3} style={{ fontSize: "6.5pt", letterSpacing: "-0.1pt" }}>ขออนุมัติเบิกค่าปฏิบัติงานนอกเวลาทำงานปกติ</th>
            </tr>
            <tr style={{ height: mm(6.6) }}>
              <th colSpan={2}>ช่วงเวลาที่ทำ OT</th>
              <th rowSpan={2}>เหตุผล</th>
              <th rowSpan={2}>ลายเซ็น<br />พนักงาน</th>
              <th rowSpan={2} style={{ fontSize: "6.5pt" }}>ลายเซ็นรับทราบ<br />(หัวหน้างาน)</th>
              <th rowSpan={2}>OT. ปกติ<br />{rateText(rates.workday)}</th>
              <th rowSpan={2}>OT. วันหยุด<br />{rateText(rates.holiday_normal)}</th>
              <th rowSpan={2}>OT. วันหยุด<br />{rateText(rates.holiday_ot)}</th>
            </tr>
            <tr style={{ height: mm(5.6) }}>
              <th>จาก</th>
              <th>ถึง</th>
              <th>จาก</th>
              <th>ถึง</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className={r.off ? "ts-off-thai" : undefined} style={{ height: mm(ROW) }}>
                <td>{Number(r.date.slice(8))}</td>
                <td>{hhmm(r.normalFrom)}</td>
                <td>{hhmm(r.normalTo)}</td>
                <td>{hhmm(r.otFrom)}</td>
                <td>{hhmm(r.otTo)}</td>
                <td className="ts-remark">{r.remark}</td>
                <td />
                <td />
                <td>{hrs(r.workdayOt)}</td>
                <td>{hrs(r.holidayNormal)}</td>
                <td>{hrs(r.holidayOt)}</td>
              </tr>
            ))}
            <tr style={{ height: mm(6.5) }}>
              <td className="ts-none" colSpan={6} style={{ borderRight: "1px solid #000" }} />
              <td colSpan={2} className="ts-b">รวม (ชั่วโมง)</td>
              <td>{hrs(sum.workdayOt)}</td>
              <td>{hrs(sum.holidayNormal)}</td>
              <td>{hrs(sum.holidayOt)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ height: mm(5.9), borderTop: "1px solid #000" }} />
        <div className="ts-sign" style={{ height: mm(19.7) }}>
          <div style={{ width: mm(54.6) }}>
            <span>({name})</span>
            <span>ผู้ขอเบิก/พนักงาน (1)</span>
          </div>
          <div style={{ width: mm(50.6) }}>
            <span />
            <span>พิจารณาเห็นชอบ (ผจก.แผนก/ผจก.ฝ่าย) (2)</span>
          </div>
          <div style={{ width: mm(44.5) }}>
            <span />
            <span>ตรวจสอบ (ฝ่ายทรัพยากรบุคคล) (3)</span>
          </div>
          <div style={{ flex: 1, borderRight: "none" }}>
            <span />
            <span>ผู้อนุมัติ (ระดับ รอง ผจก.โรงงานฯ ขึ้นไป)(4)</span>
          </div>
        </div>
        <div className="ts-notes" style={{ minHeight: mm(17), borderTop: "1px solid #000" }}>
          <span className="ts-b" style={{ textDecoration: "underline", width: mm(14), flexShrink: 0 }}>หมายเหตุ</span>
          <div>
            {f.notes.map((n, i) => (
              <div key={i}>- {n}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

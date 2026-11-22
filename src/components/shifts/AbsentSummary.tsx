"use client";

// หน้าสรุปคนขาดงาน (เปิดจากตารางผลัด): ใครขาดวันไหนบ้าง
import Link from "next/link";
import { Button, Modal } from "../ui";
import { empName, type Emp } from "./common";
import type { AbsentDay, AbsentPerson } from "@/lib/shift-absent";
import { THAI_DAYS_SHORT, thaiMonthShort, weekday } from "@/lib/shifts";

function DayChip({ d, leaveLabels }: { d: AbsentDay; leaveLabels: Map<string, string> }) {
  // วันที่ยังมีเรื่องรออนุมัติ ใช้สีเหลือง เพราะอาจไม่ใช่การขาดจริง
  const waiting = d.pendingLeave ? `รออนุมัติลา${leaveLabels.get(d.pendingLeave) ?? d.pendingLeave}` : d.pendingFix ? "รออนุมัติแก้เวลา" : null;
  return (
    <li className={`flex min-w-[76px] flex-col rounded-lg px-2 py-1 ${waiting ? "bg-warn text-ink" : "bg-black text-white"}`}>
      <span className="num text-[15px] leading-tight font-bold whitespace-nowrap">{Number(d.date.slice(8))} {thaiMonthShort(d.date.slice(0, 7))}</span>
      <span className="num text-[12px] leading-tight whitespace-nowrap">{THAI_DAYS_SHORT[weekday(d.date)]}{d.start ? ` · ${d.start}` : ""}</span>
      {waiting && <span className="text-[11px] leading-tight font-bold whitespace-nowrap">{waiting}</span>}
    </li>
  );
}

export function AbsentSummary({
  people, rangeText, sinceText, filtered, leaveLabels, onClose,
}: {
  people: AbsentPerson<Emp>[];
  rangeText: string;
  sinceText: string | null;
  filtered: boolean;
  leaveLabels: Map<string, string>;
  onClose: () => void;
}) {
  const all = people.flatMap((p) => p.days);
  const leaveWaiting = all.filter((d) => d.pendingLeave).length;
  const fixWaiting = all.filter((d) => !d.pendingLeave && d.pendingFix).length;
  return (
    <Modal title="สรุปพนักงานขาดงาน" onClose={onClose}>
      <p className="-mt-2 mb-3 text-[15px] text-muted">
        <span className="num">{rangeText}</span> · <b className="text-ink">{people.length} คน รวม {all.length} วัน</b>
        {filtered && " · เฉพาะตามตัวกรองที่เลือก"}
      </p>

      {leaveWaiting + fixWaiting > 0 && (
        <div className="mb-3 rounded-xl bg-[#fff6d6] px-3 py-2 text-[14px] leading-snug text-[#6b4e00] ring-1 ring-[#f3dc8a]">
          <b>สีเหลือง = อาจไม่ได้ขาดจริง</b> มีเรื่องรออนุมัติอยู่ เมื่ออนุมัติแล้ววันนั้นจะหายจากรายการ
          <span className="mt-1 flex flex-wrap gap-x-4 font-bold">
            {leaveWaiting > 0 && <Link href="/leave/approvals" className="underline underline-offset-2">อนุมัติใบลา ({leaveWaiting} วัน)</Link>}
            {fixWaiting > 0 && <Link href="/attendance/team" className="underline underline-offset-2">อนุมัติแก้เวลา ({fixWaiting} วัน)</Link>}
          </span>
        </div>
      )}

      <ul className="divide-y divide-line">
        {people.map(({ emp, days }) => (
          <li key={emp.id} className="py-3">
            <div className="mb-2 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] leading-tight font-bold text-brand">{empName(emp)}</p>
                <p className="truncate text-[13px] text-muted">{emp.employee_code} · {emp.position ?? "-"}</p>
              </div>
              <span className="shrink-0 rounded-md bg-black px-2 py-1 text-[14px] leading-none font-bold text-white">ขาด {days.length} วัน</span>
            </div>
            <ul className="flex flex-wrap gap-1.5" aria-label={`วันที่ ${empName(emp)} ขาดงาน`}>
              {days.map((d) => <DayChip key={d.date} d={d} leaveLabels={leaveLabels} />)}
            </ul>
          </li>
        ))}
      </ul>

      {sinceText && <p className="mt-1 text-[13px] text-muted">นับตั้งแต่ {sinceText} · มีกะทำงาน แต่ไม่ลงเวลาเข้า-ออก และไม่มีใบลาที่อนุมัติแล้ว</p>}
      <Button variant="secondary" className="mt-4 w-full" onClick={onClose}>ปิด</Button>
    </Modal>
  );
}

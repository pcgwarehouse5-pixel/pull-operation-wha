"use client";

// ใบลา 1 แถวในหน้าอนุมัติ: เห็นวันลา คนลา ประเภท เหตุผล และปุ่มในแถวเดียว · กด "รายละเอียด" เพื่อดูวันลาคงเหลือและประวัติ
import { useState, type ReactNode } from "react";
import { Badge } from "../ui";
import { LEAVE_STATUS, type LeaveApproval, type LeaveBalance, type LeaveRequest } from "@/lib/attendance";
import type { LeaveDue } from "@/lib/leave-queue";
import { THAI_DAYS_SHORT, thaiMonthShort, todayIso, weekday } from "@/lib/shifts";
import { useI18n } from "@/i18n";
import type { MsgKey } from "@/i18n/th";
import { openAttachment } from "./LeaveForm";
import { hourSpan, leaveDays, num } from "@/lib/shop-forms";
import { useLeaveHours } from "@/lib/useLeaveHours";

/** คอลัมน์บนจอกว้าง ใช้ร่วมกับหัวตาราง จึงตรงกันทุกแถว */
export const LEAVE_ROW_GRID = "xl:grid-cols-[150px_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.2fr)_300px]";

const DUE_STYLE = { urgent: "bg-bad text-white", soon: "bg-warn text-ink", normal: "bg-paper text-muted ring-1 ring-line" } as const;
const EDGE = { urgent: "border-l-bad", soon: "border-l-warn", normal: "border-l-transparent" } as const;

function dayText(iso: string) {
  const year = iso.slice(0, 4) === todayIso().slice(0, 4) ? "" : ` ${(Number(iso.slice(0, 4)) + 543) % 100}`;
  return `${Number(iso.slice(8))} ${thaiMonthShort(iso.slice(0, 7))}${year}`;
}

export function LeaveQueueRow({
  r, typeLabel, name, sub, due, approvals, balance, onOpen, actions, onError,
}: {
  r: LeaveRequest;
  typeLabel: string;
  name: string;
  sub: string;
  due: LeaveDue | null; // null = แท็บประวัติ ไม่ต้องบอกความเร่งด่วน
  approvals: LeaveApproval[];
  balance?: LeaveBalance[];
  onOpen: () => void;
  actions?: ReactNode;
  onError: (t: string) => void;
}) {
  const { t, fmt } = useI18n();
  const lh = useLeaveHours();
  const [open, setOpen] = useState(false);
  const oneDay = r.start_date === r.end_date;
  const waitingExec = r.status === "pending" && r.steps_done >= 1;
  const showStatus = !due || waitingExec || r.status === "cancel_requested";

  return (
    <li className={`border-l-4 px-3 py-3 xl:px-4 ${due ? EDGE[due.level] : "border-l-transparent"}`}>
      <div className={`grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-1 xl:items-center xl:gap-x-4 ${LEAVE_ROW_GRID}`}>
        {/* วันลา */}
        <div className="row-span-3 xl:row-span-1">
          <p className="num text-[18px] leading-tight font-bold text-ink">
            {dayText(r.start_date)} <span className="text-[13px] font-medium text-muted">{THAI_DAYS_SHORT[weekday(r.start_date)]}</span>
          </p>
          {!oneDay && <p className="num text-[13px] text-muted">ถึง {dayText(r.end_date)}</p>}
          {due && <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[12px] leading-tight font-bold ${DUE_STYLE[due.level]}`}>{due.text}</span>}
        </div>

        {/* คนลา */}
        <div className="min-w-0">
          <p className="truncate text-[16px] leading-tight font-bold text-brand">{name}</p>
          <p className="truncate text-[13px] text-muted">{sub}</p>
        </div>

        {/* ประเภทและจำนวนวัน */}
        <div className="col-start-2 min-w-0 xl:col-start-auto">
          <p className="text-[15px] leading-snug font-semibold">
            {t("lv.of", { type: typeLabel })} <span className="num font-medium text-muted">· {r.period === "hours" && r.hours ? t("lf.hoursN", { n: num(Number(r.hours)) }) : t("common.days", { n: r.days })}</span>
            {r.period === "hours" && r.hours ? (
              <span className="text-[13px] font-normal text-muted"> · {hourSpan(r)} น.</span>
            ) : (
              r.period !== "full" && <span className="text-[13px] font-normal text-muted"> · {t(`period.${r.period}` as MsgKey)}</span>
            )}
          </p>
          {(showStatus || r.over_quota || (r.steps_required > 1 && r.status === "pending")) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {showStatus && <Badge tone={LEAVE_STATUS[r.status].tone}>{waitingExec ? t("lv.waitingExec") : t(`lvs.${r.status}` as MsgKey)}</Badge>}
              {r.steps_required > 1 && r.status === "pending" && <span className="text-[12px] text-muted">{t("lv.step", { a: r.steps_done + 1, b: r.steps_required })}</span>}
              {r.over_quota && <Badge tone="red">{t("lv.overQuota")}</Badge>}
            </div>
          )}
        </div>

        {/* เหตุผล + ลิงก์ */}
        <div className="col-start-2 min-w-0 xl:col-start-auto">
          <p className="line-clamp-2 text-[14px] leading-snug text-muted" title={r.reason ?? undefined}>{r.reason || "ไม่ระบุเหตุผล"}</p>
          <div className="flex flex-wrap items-center gap-x-3 text-[14px] font-semibold text-brand">
            <button
              type="button"
              className="min-h-8"
              aria-expanded={open}
              onClick={() => {
                if (!open) onOpen();
                setOpen(!open);
              }}
            >
              รายละเอียด <span aria-hidden="true">{open ? "▴" : "▾"}</span>
            </button>
            {r.attachment_path && (
              <button
                type="button"
                className="min-h-8"
                onClick={async () => {
                  const e = await openAttachment(r.attachment_path!);
                  if (e) onError(e);
                }}
              >
                {t("lv.attachment")}
              </button>
            )}
          </div>
        </div>

        {/* ปุ่มอนุมัติ */}
        {actions && <div className="col-span-2 mt-1 xl:col-span-1 xl:mt-0">{actions}</div>}
      </div>

      {open && (
        <div className="mt-2 space-y-2 rounded-xl bg-paper p-3 text-[14px]">
          {r.reason && <p className="break-words"><b>เหตุผล:</b> {r.reason}</p>}
          <p><b>ยื่นเมื่อ:</b> <span className="num">{fmt.dateTime(r.created_at)}</span></p>
          <div>
            <p className="mb-1 font-bold">วันลาคงเหลือปีนี้</p>
            {balance ? (
              <div className="flex flex-wrap gap-1.5">
                {balance.map((b) => (
                  <Badge key={b.leave_type} tone={b.leave_type === r.leave_type ? "blue" : "slate"}>
                    {b.label} {b.quota === null ? `ใช้ ${leaveDays(Number(b.approved) + Number(b.pending), lh.hoursPerDay)}` : `เหลือ ${leaveDays(Number(b.remaining), lh.hoursPerDay)}/${Number(b.quota)}`}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted">กำลังโหลด...</p>
            )}
          </div>
          {approvals.length > 0 && (
            <div>
              <p className="mb-1 font-bold">{t("lv.history", { n: approvals.length })}</p>
              <ul className="space-y-1">
                {approvals.map((a) => (
                  <li key={a.id}>
                    <b>{t(`lva.${a.action}` as MsgKey)}</b> · {a.actor_name ?? "-"}
                    {a.actor_role ? ` (${t(`role.${a.actor_role}` as MsgKey)})` : ""} · {fmt.dateTime(a.created_at)}
                    {a.note && <span className="block text-muted">“{a.note}”</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

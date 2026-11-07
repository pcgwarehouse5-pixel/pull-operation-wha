"use client";

// การ์ดใบลา 1 ใบ (ใช้ทั้งหน้าลาของฉันและหน้าอนุมัติ)
import { useState, type ReactNode } from "react";
import { Badge, Card } from "../ui";
import { LEAVE_STATUS, type LeaveApproval, type LeaveRequest } from "@/lib/attendance";
import { useI18n } from "@/i18n";
import type { MsgKey } from "@/i18n/th";
import { openAttachment } from "./LeaveForm";

export function LeaveItem({
  r, typeLabel, who, approvals, actions, onError,
}: {
  r: LeaveRequest;
  typeLabel: string;
  who?: ReactNode;
  approvals?: LeaveApproval[];
  actions?: ReactNode;
  onError?: (t: string) => void;
}) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const st = LEAVE_STATUS[r.status];
  const waitingExec = r.status === "pending" && r.steps_done >= 1;
  const range =
    r.start_date === r.end_date
      ? `${fmt.day(r.start_date)}${r.period !== "full" ? ` (${t(`period.${r.period}` as MsgKey)})` : ""}`
      : `${fmt.day(r.start_date)} – ${fmt.day(r.end_date)}`;
  return (
    <Card className="!p-3.5">
      {who && <div className="mb-1">{who}</div>}
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 w-1.5 self-stretch rounded-full ${r.status === "approved" ? "bg-ok" : r.status === "rejected" ? "bg-bad" : r.status === "cancelled" ? "bg-[#a9b2c8]" : "bg-warn"}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] leading-tight font-bold">
            {t("lv.of", { type: typeLabel })} <span className="num font-semibold text-muted">· {t("common.days", { n: r.days })}</span>
          </p>
          <p className="text-[15px]">{range}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={st.tone}>{waitingExec ? t("lv.waitingExec") : t(`lvs.${r.status}` as MsgKey)}</Badge>
          {r.steps_required > 1 && r.status === "pending" && <span className="text-[12px] text-muted">{t("lv.step", { a: r.steps_done + 1, b: r.steps_required })}</span>}
          {r.over_quota && <Badge tone="red">{t("lv.overQuota")}</Badge>}
        </div>
      </div>
      {r.reason && <p className="mt-1.5 text-[14px] text-muted">{t("lv.reason", { r: r.reason })}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 text-[14px]">
        {r.attachment_path && (
          <button
            type="button"
            className="font-semibold text-brand underline-offset-2 hover:underline"
            onClick={async () => {
              const e = await openAttachment(r.attachment_path!);
              if (e) onError?.(e);
            }}
          >
            {t("lv.attachment")}
          </button>
        )}
        {approvals && approvals.length > 0 && (
          <button type="button" className="font-semibold text-brand" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? t("lv.hideHistory") : t("lv.history", { n: approvals.length })}
          </button>
        )}
      </div>
      {open && approvals && (
        <ul className="mt-2 space-y-1 rounded-xl bg-paper p-2.5 text-[14px]">
          {approvals.map((a) => (
            <li key={a.id}>
              <b>{t(`lva.${a.action}` as MsgKey)}</b> · {a.actor_name ?? "-"}
              {a.actor_role ? ` (${t(`role.${a.actor_role}` as MsgKey)})` : ""} · {fmt.dateTime(a.created_at)}
              {a.note && <span className="block text-muted">“{a.note}”</span>}
            </li>
          ))}
        </ul>
      )}
      {actions && <div className="mt-3">{actions}</div>}
    </Card>
  );
}

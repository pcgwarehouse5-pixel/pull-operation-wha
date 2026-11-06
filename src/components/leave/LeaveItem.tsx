"use client";

// การ์ดใบลา 1 ใบ (ใช้ทั้งหน้าลาของฉันและหน้าอนุมัติ)
import { useState, type ReactNode } from "react";
import { Badge, Card } from "../ui";
import { shortDay, thaiDateTime } from "@/lib/format";
import { APPROVAL_ACTION, LEAVE_STATUS, leaveRange, type LeaveApproval, type LeaveRequest } from "@/lib/attendance";
import { ROLE_LABEL, type AppRole } from "@/lib/types";
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
  const [open, setOpen] = useState(false);
  const st = LEAVE_STATUS[r.status];
  const waitingExec = r.status === "pending" && r.steps_done >= 1;
  return (
    <Card className="!p-3.5">
      {who && <div className="mb-1">{who}</div>}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            ลา{typeLabel} · {r.days} วัน
          </p>
          <p className="text-[15px]">{leaveRange(r, shortDay)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={st.tone}>{waitingExec ? "รอผู้บริหาร" : st.label}</Badge>
          {r.steps_required > 1 && r.status === "pending" && <span className="text-[12px] text-muted">ขั้น {r.steps_done + 1}/{r.steps_required}</span>}
          {r.over_quota && <Badge tone="red">เกินโควตา</Badge>}
        </div>
      </div>
      {r.reason && <p className="mt-1 text-[14px] text-muted">เหตุผล: {r.reason}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[14px]">
        {r.attachment_path && (
          <button type="button" className="font-semibold text-brand underline-offset-2 hover:underline" onClick={async () => { const e = await openAttachment(r.attachment_path!); if (e) onError?.(e); }}>
            ดูไฟล์แนบ
          </button>
        )}
        {approvals && approvals.length > 0 && (
          <button type="button" className="font-semibold text-brand" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "ซ่อนประวัติ" : `ประวัติการอนุมัติ (${approvals.length})`}
          </button>
        )}
      </div>
      {open && approvals && (
        <ul className="mt-2 space-y-1 rounded-xl bg-paper p-2.5 text-[14px]">
          {approvals.map((a) => (
            <li key={a.id}>
              <b>{APPROVAL_ACTION[a.action]}</b> · {a.actor_name ?? "-"}
              {a.actor_role ? ` (${ROLE_LABEL[a.actor_role as AppRole] ?? a.actor_role})` : ""} · {thaiDateTime(a.created_at)}
              {a.note && <span className="block text-muted">“{a.note}”</span>}
            </li>
          ))}
        </ul>
      )}
      {actions && <div className="mt-3">{actions}</div>}
    </Card>
  );
}

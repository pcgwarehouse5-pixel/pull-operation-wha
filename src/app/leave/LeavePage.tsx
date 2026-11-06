"use client";

// ลางาน: วันลาคงเหลือ ยื่นใบลา ประวัติ และยกเลิก
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { LeaveForm } from "@/components/leave/LeaveForm";
import { LeaveItem } from "@/components/leave/LeaveItem";
import { RejectModal } from "@/components/attendance/RejectModal";
import { errText, sb } from "@/lib/supabase";
import { type LeaveApproval, type LeaveBalance, type LeaveRequest } from "@/lib/attendance";

type Msg = { tone: "success" | "error"; text: string };

export default function LeavePage() {
  const { profile: me, demo } = useApp();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [bal, setBal] = useState<LeaveBalance[] | null>(null);
  const [reqs, setReqs] = useState<LeaveRequest[] | null>(null);
  const [apps, setApps] = useState<LeaveApproval[]>([]);
  const [form, setForm] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);

  const load = useCallback(async () => {
    if (demo) {
      setBal(demo.PREVIEW_BALANCE);
      setReqs(demo.previewLeaves(me.id).filter((r) => r.user_id === me.id));
      setApps([]);
      return;
    }
    try {
      const [b, r] = await Promise.all([
        sb().rpc("leave_balance", { p_year: year }),
        sb().from("leave_requests").select("*").eq("user_id", me.id).gte("start_date", `${year}-01-01`).lte("start_date", `${year}-12-31`).order("start_date", { ascending: false }),
      ]);
      if (b.error) throw b.error;
      if (r.error) throw r.error;
      const list = (r.data ?? []) as LeaveRequest[];
      setBal((b.data ?? []) as LeaveBalance[]);
      setReqs(list);
      if (list.length) {
        const a = await sb().from("leave_approvals").select("*").in("request_id", list.map((x) => x.id)).order("created_at");
        setApps((a.data ?? []) as LeaveApproval[]);
      } else setApps([]);
    } catch (e) {
      setBal([]);
      setReqs([]);
      setMsg({ tone: "error", text: errText(e) });
    }
  }, [demo, me.id, year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า/เปลี่ยนปี
    load();
  }, [load]);

  const label = (v: string) => bal?.find((b) => b.leave_type === v)?.label ?? v;

  async function cancel(r: LeaveRequest, reason?: string) {
    if (r.status === "pending" && !confirm(`ยกเลิกใบลา${label(r.leave_type)}นี้?`)) return;
    if (demo) return setCancelling(null);
    const { data, error } = await sb().rpc("cancel_leave", { p_id: r.id, p_reason: reason ?? null });
    if (error) return setMsg({ tone: "error", text: errText(error) });
    setCancelling(null);
    setMsg({ tone: "success", text: data === "cancel_requested" ? "ส่งคำขอยกเลิกแล้ว รอผู้อนุมัติ" : "ยกเลิกใบลาแล้ว" });
    load();
  }

  return (
    <AppShell title="ลางาน">
      <div className="mb-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" aria-label="ปีก่อน" onClick={() => setYear(year - 1)}>
          <Icon name="back" size={18} />
        </Button>
        <span className="min-w-20 text-center text-lg font-bold text-brand">ปี {year + 543}</span>
        <Button variant="secondary" size="sm" aria-label="ปีถัดไป" onClick={() => setYear(year + 1)}>
          <Icon name="next" size={18} />
        </Button>
        <Button className="ml-auto" onClick={() => setForm(true)}>
          <Icon name="plus" size={20} /> ยื่นใบลา
        </Button>
      </div>
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <h2 className="mb-2 px-1 font-bold text-brand">วันลาคงเหลือ</h2>
      {!bal ? (
        <Loading />
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {bal.map((b) => (
            <Card key={b.leave_type} className="!p-3">
              <p className="text-[14px] text-muted">ลา{b.label}</p>
              {b.quota === null ? (
                <p className="text-lg font-bold">ใช้ไป {Number(b.approved) + Number(b.pending)} วัน</p>
              ) : (
                <p className={`text-2xl font-bold ${Number(b.remaining) < 0 ? "text-bad" : "text-brand"}`}>
                  {Number(b.remaining)} <span className="text-[14px] font-semibold text-muted">/ {Number(b.quota)} วัน</span>
                </p>
              )}
              {Number(b.pending) > 0 && <p className="text-[12px] text-[#7a5410]">รออนุมัติ {Number(b.pending)} วัน</p>}
            </Card>
          ))}
        </div>
      )}

      <h2 className="mb-2 px-1 font-bold text-brand">ใบลาของฉัน</h2>
      {!reqs ? (
        <Loading />
      ) : !reqs.length ? (
        <Empty>ยังไม่มีใบลาในปีนี้</Empty>
      ) : (
        <ul className="space-y-2">
          {reqs.map((r) => (
            <li key={r.id}>
              <LeaveItem
                r={r}
                typeLabel={label(r.leave_type)}
                approvals={apps.filter((a) => a.request_id === r.id)}
                onError={(t) => setMsg({ tone: "error", text: t })}
                actions={
                  r.status === "pending" ? (
                    <Button size="sm" variant="secondary" onClick={() => cancel(r)}>ยกเลิกใบลา</Button>
                  ) : r.status === "approved" ? (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>ขอยกเลิก</Button>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 px-1 text-[13px] text-muted">โควตาวันลาตั้งโดยบริษัท (ตั้งค่า → กฎและอัตรา) หากสงสัยเรื่องสิทธิ์วันลาตามกฎหมาย สอบถามฝ่ายบุคคล</p>

      {form && (
        <LeaveForm
          onClose={() => setForm(false)}
          onDone={(text) => {
            setForm(false);
            setMsg({ tone: "success", text });
            load();
          }}
        />
      )}
      {cancelling && (
        <RejectModal
          title="ขอยกเลิกใบลาที่อนุมัติแล้ว"
          label="เหตุผลที่ขอยกเลิก"
          okText="ส่งคำขอยกเลิก"
          onClose={() => setCancelling(null)}
          onOk={(n) => cancel(cancelling, n)}
        />
      )}
    </AppShell>
  );
}

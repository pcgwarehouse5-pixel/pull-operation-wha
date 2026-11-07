"use client";

// ลางาน: วันลาคงเหลือ ยื่นใบลา ประวัติ และยกเลิก
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Button, Card, Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { PageHelper } from "@/components/Puinun";
import { LeaveForm } from "@/components/leave/LeaveForm";
import { LeaveItem } from "@/components/leave/LeaveItem";
import { RejectModal } from "@/components/attendance/RejectModal";
import { sb } from "@/lib/supabase";
import { type LeaveApproval, type LeaveBalance, type LeaveRequest } from "@/lib/attendance";
import { localizeError, useI18n } from "@/i18n";

type Msg = { tone: "success" | "error"; text: string };

export default function LeavePage() {
  const { profile: me, demo } = useApp();
  const { t, fmt } = useI18n();
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
      setMsg({ tone: "error", text: localizeError((e as Error).message ?? String(e), t) });
    }
  }, [demo, me.id, year, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปิดหน้า/เปลี่ยนปี
    load();
  }, [load]);

  const label = (v: string) => bal?.find((b) => b.leave_type === v)?.label ?? v;

  async function cancel(r: LeaveRequest, reason?: string) {
    if (r.status === "pending" && !confirm(t("lv.cancelConfirm", { type: label(r.leave_type) }))) return;
    if (demo) return setCancelling(null);
    const { data, error } = await sb().rpc("cancel_leave", { p_id: r.id, p_reason: reason ?? null });
    if (error) return setMsg({ tone: "error", text: localizeError(error.message, t) });
    setCancelling(null);
    setMsg({ tone: "success", text: data === "cancel_requested" ? t("lv.cancelRequested") : t("lv.cancelled") });
    load();
  }

  return (
    <AppShell title={t("lv.title")}>
      <PageHelper
        pose="docs"
        title={t("lv.title")}
        action={
          <Button onClick={() => setForm(true)}>
            <Icon name="plus" size={20} /> {t("lv.request")}
          </Button>
        }
      >
        {t("lv.helper")}
      </PageHelper>
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-lg font-bold text-brand">{t("lv.balance")}</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label={t("common.prevYear")} onClick={() => setYear(year - 1)}>
            <Icon name="back" size={18} />
          </Button>
          <span className="min-w-20 text-center font-semibold">{t("common.year", { y: fmt.year(year) })}</span>
          <Button variant="secondary" size="sm" aria-label={t("common.nextYear")} onClick={() => setYear(year + 1)}>
            <Icon name="next" size={18} />
          </Button>
        </div>
      </div>
      {!bal ? (
        <Loading />
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {bal.map((b) => {
            const used = Number(b.approved) + Number(b.pending);
            const pct = b.quota ? Math.min(100, (used / Number(b.quota)) * 100) : 0;
            return (
              <Card key={b.leave_type} className="!p-3">
                <p className="text-[14px] text-muted">{t("lv.of", { type: b.label })}</p>
                {b.quota === null ? (
                  <p className="text-lg font-bold">{t("lv.used", { n: used })}</p>
                ) : (
                  <>
                    <p className={`num text-[28px] leading-tight font-bold ${Number(b.remaining) < 0 ? "text-bad" : "text-brand"}`}>
                      {Number(b.remaining)} <span className="text-[14px] font-semibold text-muted">{t("lv.ofQuota", { q: Number(b.quota) })}</span>
                    </p>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
                      <span className={`block h-full rounded-full ${pct >= 100 ? "bg-bad" : "bg-brand"}`} style={{ width: `${pct}%` }} />
                    </span>
                  </>
                )}
                {Number(b.pending) > 0 && <p className="mt-1 text-[12px] font-semibold text-[#6b4e00]">{t("lv.pendingDays", { n: Number(b.pending) })}</p>}
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 text-lg font-bold text-brand">{t("lv.mine")}</h2>
      {!reqs ? (
        <Loading />
      ) : !reqs.length ? (
        <Empty pose="happy">{t("lv.none")}</Empty>
      ) : (
        <ul className="space-y-2">
          {reqs.map((r) => (
            <li key={r.id}>
              <LeaveItem
                r={r}
                typeLabel={label(r.leave_type)}
                approvals={apps.filter((a) => a.request_id === r.id)}
                onError={(e) => setMsg({ tone: "error", text: e })}
                actions={
                  r.status === "pending" ? (
                    <Button size="sm" variant="secondary" onClick={() => cancel(r)}>{t("lv.cancel")}</Button>
                  ) : r.status === "approved" ? (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>{t("lv.requestCancel")}</Button>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 px-1 text-[13px] text-muted">{t("lv.quotaNote")}</p>

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
        <RejectModal title={t("lv.cancelTitle")} label={t("lv.cancelReason")} okText={t("lv.cancelSend")} onClose={() => setCancelling(null)} onOk={(n) => cancel(cancelling, n)} />
      )}
    </AppShell>
  );
}

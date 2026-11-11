"use client";

// สรุปของฉันบนหน้าหลัก (คนที่ลงเวลา): ตำแหน่ง+เวลาพักวันนี้ / OT เดือนนี้ / วันลาคงเหลือ / ใบลาล่าสุด
// แตะการ์ดเพื่อไปดูรายละเอียดในหน้านั้น
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/components/AuthProvider";
import { Badge } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { SkillIcon } from "@/components/pull/PullUI";
import { BreakPill } from "@/components/pull/MyPositionCard";
import { useMyPositions } from "@/components/pull/useMyPositions";
import { useI18n } from "@/i18n";
import type { MsgKey } from "@/i18n/th";
import { sb } from "@/lib/supabase";
import { monthDates, todayIso } from "@/lib/shifts";
import { fmtHours, otBuckets, rateLabel, type OtRow } from "@/lib/ot";
import { LEAVE_STATUS, type LeaveBalance, type LeaveRequest } from "@/lib/attendance";
import { currentPosition } from "@/lib/my-position";

function Tile({ href, icon, title, children }: { href: string; icon: IconName; title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Link href={href} className="block rounded-[20px] bg-white p-3.5 ring-1 ring-line transition hover:ring-brand/40">
      <p className="mb-2 flex items-center gap-2 font-bold text-brand">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky">
          <Icon name={icon} size={18} />
        </span>
        <span className="flex-1">{title}</span>
        <span className="flex items-center text-[13px] font-semibold text-muted">
          {t("home.seeAll")} <Icon name="next" size={16} />
        </span>
      </p>
      {children}
    </Link>
  );
}

export function MySummary() {
  const { profile: me, demo } = useApp();
  const { t, fmt } = useI18n();
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const pos = useMyPositions(1);
  const [ot, setOt] = useState<OtRow[] | null>(null);
  const [bal, setBal] = useState<LeaveBalance[] | null>(null);
  const [leaves, setLeaves] = useState<LeaveRequest[] | null>(null);

  useEffect(() => {
    const dates = monthDates(today.slice(0, 7));
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setOt(demo.previewOt(dates[0]).filter((r) => r.user_id === "p1") as OtRow[]);
      setBal(demo.PREVIEW_BALANCE);
      setLeaves(demo.previewLeaves(me.id).filter((r) => r.user_id === me.id) as LeaveRequest[]);
      return;
    }
    let live = true;
    Promise.all([
      sb().rpc("my_ot", { p_from: dates[0], p_to: today }),
      sb().rpc("leave_balance", { p_year: year }),
      sb().from("leave_requests").select("*").eq("user_id", me.id).order("start_date", { ascending: false }).limit(3),
    ]).then(([o, b, l]) => {
      if (!live) return;
      setOt((o.data ?? []) as OtRow[]);
      setBal((b.data ?? []) as LeaveBalance[]);
      setLeaves((l.data ?? []) as LeaveRequest[]);
    });
    return () => {
      live = false;
    };
  }, [demo, me.id, today, year]);

  const cur = pos.rows ? currentPosition(pos.rows, pos.shifts, today, new Date()) : null;
  const todayShift = pos.shifts[today];
  const approved = otBuckets((ot ?? []).filter((r) => r.approval === "approved"));
  const approvedTotal = [...approved.values()].reduce((a, b) => a + b, 0);
  const waiting = [...otBuckets((ot ?? []).filter((r) => r.approval === "pending" || r.approval === "changed")).values()].reduce((a, b) => a + b, 0);
  const typeLabel = (v: string) => bal?.find((b) => b.leave_type === v)?.label ?? v;

  return (
    <section className="mb-4 space-y-2.5">
      {/* ตำแหน่งงานวันนี้ */}
      {cur && (cur.pos || todayShift?.start) && (
        <Tile href="/my-position" icon="grid" title={t("nav.my-position")}>
          {cur.pos ? (
            <div className="flex items-center gap-3">
              <SkillIcon name={cur.pos.skill_name} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[19px] leading-tight font-bold text-ink">{cur.pos.skill_name}</p>
                <p className="text-[14px] text-muted">
                  {cur.pos.to_code} · {t(cur.pos.shift === "morning" ? "pull.my.morning" : "pull.my.night")}
                  {cur.pos.away && <span className="ml-1 font-semibold text-[#b45309]">· {t("mp.away", { wh: cur.pos.to_code })}</span>}
                </p>
                <div className="mt-1.5">
                  <BreakPill time={cur.pos.break_time} size="sm" />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[15px] font-semibold text-ink">{t("mp.notYet")}</p>
          )}
        </Tile>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {/* OT เดือนนี้ */}
        <Tile href="/attendance" icon="ot" title={t("home.otMonth")}>
          {!ot ? (
            <p className="h-12" />
          ) : approvedTotal > 0 || waiting > 0 ? (
            <>
              <p className="num text-[28px] leading-tight font-bold text-brand">
                {fmtHours(approvedTotal)} <span className="text-[14px] font-semibold text-muted">{t("common.hours", { n: "" }).trim()}</span>
              </p>
              {approved.size > 0 && (
                <p className="text-[13px] text-muted">{[...approved].map(([r, h]) => `${rateLabel(r)} ${t("common.hours", { n: fmtHours(h) })}`).join(" · ")}</p>
              )}
              {waiting > 0 && <p className="mt-1 text-[13px] font-semibold text-[#6b4e00]">{t("home.otWaiting", { n: fmtHours(waiting) })}</p>}
            </>
          ) : (
            <p className="text-[15px] text-muted">{t("home.otNone")}</p>
          )}
        </Tile>

        {/* วันลาคงเหลือ */}
        <Tile href="/leave" icon="leave" title={t("home.leaveLeft")}>
          {!bal ? (
            <p className="h-12" />
          ) : (
            <ul className="grid grid-cols-3 gap-1.5">
              {bal.map((b) => (
                <li key={b.leave_type} className="rounded-xl bg-paper px-2 py-1.5 text-center">
                  <span className="block truncate text-[12px] text-muted">{b.label}</span>
                  <span className={`num block text-[20px] leading-tight font-bold ${b.remaining !== null && Number(b.remaining) < 0 ? "text-bad" : "text-brand"}`}>
                    {b.quota === null ? "-" : Number(b.remaining)}
                  </span>
                  {b.quota !== null && <span className="block text-[11px] text-muted">{t("lv.ofQuota", { q: Number(b.quota) })}</span>}
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </div>

      {/* ใบลาล่าสุด */}
      <Tile href="/leave" icon="history" title={t("home.recentLeave")}>
        {!leaves ? (
          <p className="h-8" />
        ) : leaves.length ? (
          <ul className="divide-y divide-line">
            {leaves.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-1.5 text-[14px]">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{t("lv.of", { type: typeLabel(r.leave_type) })}</span>{" "}
                  <span className="text-muted">
                    · {r.start_date === r.end_date ? fmt.day(r.start_date) : `${fmt.day(r.start_date)} – ${fmt.day(r.end_date)}`} · {t("common.days", { n: r.days })}
                  </span>
                </span>
                <Badge tone={LEAVE_STATUS[r.status].tone}>{t(`lvs.${r.status}` as MsgKey)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted">{t("home.noLeave")}</p>
        )}
      </Tile>
    </section>
  );
}

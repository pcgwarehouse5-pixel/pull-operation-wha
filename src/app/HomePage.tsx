"use client";

// หน้าหลัก: ทักทาย + กะวันนี้ + ปุ่มลงเวลา (งานที่ทำบ่อยที่สุด) + งานรออนุมัติของหัวหน้า + ทางลัด
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Icon } from "@/components/Icon";
import { Puinun } from "@/components/Puinun";
import { MySummary } from "@/components/home/MySummary";
import { navFor, type NavItem } from "@/lib/nav";
import { sb } from "@/lib/supabase";
import { isGlobal, isSupervisorUp, noTimekeeping } from "@/lib/types";
import { todayIso } from "@/lib/shifts";
import type { AttendanceRow } from "@/lib/attendance";
import { useI18n } from "@/i18n";
import type { MsgKey } from "@/i18n/th";

export default function HomePage() {
  const { profile, warehouses, myWarehouseIds, demo } = useApp();
  const { t, fmt } = useI18n();
  const today = todayIso();
  const [row, setRow] = useState<AttendanceRow | null | undefined>(undefined);
  const [pending, setPending] = useState<{ leave: number; fix: number }>({ leave: 0, fix: 0 });
  const boss = isSupervisorUp(profile.role);
  const timekeep = !noTimekeeping(profile.role); // ผู้จัดการฝ่ายขึ้นไปไม่ลงเวลา
  const mine = warehouses.filter((w) => myWarehouseIds.includes(w.id));
  const items = navFor(profile.role).flatMap((g) => g.items).filter((i) => i.key !== "home" && i.key !== "attendance");

  useEffect(() => {
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setRow(demo.previewAttendance([today], profile.id, today)[0] as AttendanceRow);
      setPending(boss ? { leave: 2, fix: 1 } : { leave: 0, fix: 0 });
      return;
    }
    let live = true;
    if (timekeep)
      sb()
        .rpc("my_attendance", { p_from: today, p_to: today })
        .then(({ data }) => live && setRow(((data ?? []) as AttendanceRow[])[0] ?? null));
    if (boss) {
      Promise.all([
        sb().from("leave_requests").select("id", { count: "exact", head: true }).in("status", ["pending", "cancel_requested"]).neq("user_id", profile.id),
        sb().from("attendance_corrections").select("id", { count: "exact", head: true }).eq("status", "pending").neq("user_id", profile.id),
      ]).then(([l, c]) => live && setPending({ leave: l.count ?? 0, fix: c.count ?? 0 }));
    }
    return () => {
      live = false;
    };
  }, [demo, today, profile.id, boss, timekeep]);

  const clockedIn = !!row?.first_in && !row?.last_out;
  const name = profile.nickname || profile.first_name_th;
  const label = (i: NavItem) => t(`nav.${i.key}` as MsgKey);

  return (
    <AppShell title={t("nav.home")}>
      {/* ทักทาย + กะวันนี้ + ลงเวลา */}
      <section className="relative mb-4 overflow-hidden rounded-[26px] bg-sky">
        <div className="flex items-end gap-1 pr-4 pl-1">
          <Puinun pose={clockedIn ? "happy" : "wave"} height={150} priority animate className="-mb-1" />
          <div className="min-w-0 flex-1 pt-4 pb-4">
            <p className="text-[14px] text-muted">{t("home.today", { date: fmt.day(today) })}</p>
            <h1 className="text-[26px] leading-tight font-bold text-brand">{t("home.hello", { name })}</h1>
            {timekeep && <div className="mt-2.5 rounded-2xl bg-white/80 px-3 py-2">
              <p className="text-[13px] text-muted">{t("home.shiftToday")}</p>
              {row === undefined ? (
                <p className="h-7" />
              ) : row?.shift_code && row.shift_start ? (
                <p className="num text-[22px] leading-tight font-bold text-ink">
                  {fmt.time(row.shift_start)}–{fmt.time(row.shift_end)}
                  <span className="ml-2 text-[14px] font-semibold text-muted">{row.shift_code}</span>
                </p>
              ) : (
                <p className="text-[15px] font-semibold text-ink">{row?.shift_code ?? t("home.noShift")}</p>
              )}
            </div>}
          </div>
        </div>
        {timekeep && <div className="px-4 pb-4">
          <Link
            href="/attendance"
            className={`flex min-h-16 items-center justify-center gap-3 rounded-[18px] border-b-[4px] text-[19px] font-bold text-white transition active:translate-y-[2px] active:border-b-[2px] ${
              clockedIn ? "border-[#0e5c39] bg-ok" : "border-brand-deep bg-brand"
            }`}
          >
            <Icon name="pin" size={24} />
            {clockedIn ? t("home.clockOut") : t("home.clockIn")}
          </Link>
          {clockedIn && row?.first_in && <p className="mt-2 text-center text-[14px] font-semibold text-ok">{t("home.inAt", { t: fmt.time(row.first_in) })}</p>}
        </div>}
      </section>

      {/* สรุปของฉัน: ตำแหน่งวันนี้ OT วันลา (คนที่ลงเวลา) */}
      {timekeep && <MySummary />}

      {/* งานรอดำเนินการ (หัวหน้างานขึ้นไป) */}
      {boss && (pending.leave > 0 || pending.fix > 0) && (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-[15px] font-bold text-ink">{t("home.waitingYou")}</h2>
          <div className="grid grid-cols-2 gap-2">
            {pending.leave > 0 && <Waiting href="/leave/approvals" n={pending.leave} label={t("home.leavePending")} icon="leave" />}
            {pending.fix > 0 && <Waiting href="/attendance/team" n={pending.fix} label={t("home.fixPending")} icon="clock" />}
          </div>
        </section>
      )}

      {/* ทางลัด */}
      <h2 className="mb-2 px-1 text-[15px] font-bold text-ink">{t("home.shortcuts")}</h2>
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {items.map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="group flex h-full min-h-[104px] flex-col gap-1.5 rounded-[20px] bg-white p-3.5 ring-1 ring-line transition hover:ring-brand/40">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky text-brand transition group-hover:bg-brand group-hover:text-white">
                <Icon name={i.icon} />
              </span>
              <span className="leading-tight font-semibold">{label(i)}</span>
              <span className="text-[12.5px] leading-snug text-muted">{t(`nav.${i.key}.desc` as MsgKey)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <dl className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-1 text-[13px] text-muted">
        <div className="flex gap-1.5">
          <dt>{t("home.role")}:</dt>
          <dd className="font-semibold text-ink">{t(`role.${profile.role}` as MsgKey)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{t("home.warehouse")}:</dt>
          <dd className="font-semibold text-ink">{isGlobal(profile.role) ? t("home.allWarehouses") : mine.map((w) => w.code).join(", ") || "-"}</dd>
        </div>
      </dl>
    </AppShell>
  );
}

function Waiting({ href, n, label, icon }: { href: string; n: number; label: string; icon: "leave" | "clock" }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-[18px] bg-white p-3 ring-1 ring-[#f3dc8a] transition hover:ring-warn">
      <span className="num flex h-11 min-w-11 items-center justify-center rounded-xl bg-warn px-2 text-xl font-bold text-ink">{n}</span>
      <span className="min-w-0 text-[14px] leading-snug font-semibold">
        <Icon name={icon} size={16} className="mr-1 inline text-muted" />
        {label}
      </span>
    </Link>
  );
}

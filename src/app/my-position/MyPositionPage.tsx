"use client";

// ตำแหน่งงานวันนี้ (ของพนักงาน): หัวหน้าจัดตำแหน่งในหน้า Pull แล้ว พนักงานเห็นตำแหน่ง คลัง กะ และเวลาพักของตัวเองบนมือถือ
// เห็นเฉพาะของตัวเอง (สิทธิ์ในฐานข้อมูลกันไว้แล้ว)
import { AppShell } from "@/components/AppShell";
import { Alert, Button, Empty, Loading } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { PageHelper } from "@/components/Puinun";
import { PositionHero, PositionRow } from "@/components/pull/MyPositionCard";
import { useMyPositions } from "@/components/pull/useMyPositions";
import { useI18n } from "@/i18n";
import { todayIso } from "@/lib/shifts";
import { currentPosition, upcomingPositions } from "@/lib/my-position";

export default function MyPositionPage() {
  const { t, fmt } = useI18n();
  const { rows, shifts, err, reload } = useMyPositions(7);
  const today = todayIso();

  if (!rows)
    return (
      <AppShell title={t("mp.title")}>
        <Loading />
      </AppShell>
    );

  const cur = currentPosition(rows, shifts, today, new Date());
  const next = upcomingPositions(rows, cur.date);
  const todayShift = shifts[today];
  const label = cur.date === today ? `${t("mp.today")} · ${fmt.day(cur.date)}` : `${t("mp.lastNight")} · ${fmt.day(cur.date)}`;

  return (
    <AppShell title={t("mp.title")}>
      <PageHelper
        pose="point"
        title={t("mp.title")}
        action={
          <Button variant="secondary" size="sm" onClick={reload} aria-label="refresh">
            <Icon name="history" size={18} />
          </Button>
        }
      >
        {t("mp.helper")}
      </PageHelper>
      {err && (
        <div className="mb-4">
          <Alert tone="error">{err}</Alert>
        </div>
      )}

      {cur.pos ? (
        <PositionHero pos={cur.pos} shift={shifts[cur.date]} label={label} />
      ) : (
        <Empty pose={todayShift?.start ? "think" : "happy"}>
          <p className="text-[13px]">{label}</p>
          {todayShift?.start ? (
            <>
              <p className="mt-1 text-lg font-bold text-ink">{t("mp.notYet")}</p>
              <p className="num font-semibold text-ink">
                {fmt.time(todayShift.start)}–{fmt.time(todayShift.end)} <span className="text-muted">{todayShift.code}</span>
              </p>
              <p className="mt-1 text-[14px]">{t("mp.notYetHint")}</p>
            </>
          ) : (
            <p className="mt-1 text-lg font-bold text-ink">{todayShift?.code ? `${t("mp.noShift")} (${todayShift.code})` : t("mp.noShift")}</p>
          )}
        </Empty>
      )}

      <h2 className="mt-5 mb-2 px-1 text-[15px] font-bold text-ink">{t("mp.upcoming")}</h2>
      {next.length ? (
        <ul className="space-y-2">
          {next.map((p) => (
            <PositionRow key={p.id} pos={p} shift={shifts[p.work_date]} />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-white px-4 py-3 text-[14px] text-muted ring-1 ring-line">{t("mp.noUpcoming")}</p>
      )}
    </AppShell>
  );
}

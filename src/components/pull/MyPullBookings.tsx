"use client";

// การ์ด "ตำแหน่งงานที่หัวหน้าจัดให้" ในหน้าตารางกะของฉัน: วันนี้และวันถัดไป พร้อมเวลาพัก (ไทย/พม่า)
import Link from "next/link";
import { Card } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/i18n";
import { todayIso } from "@/lib/shifts";
import { PositionRow } from "@/components/pull/MyPositionCard";
import { useMyPositions } from "@/components/pull/useMyPositions";

export function MyPullBookings() {
  const { t } = useI18n();
  const { rows, shifts } = useMyPositions(14);
  const today = todayIso();
  const list = (rows ?? []).filter((r) => r.work_date >= today);

  if (!list.length) return null;
  return (
    <Card className="mb-4 bg-sky">
      <h2 className="flex items-center gap-2 text-lg font-bold text-brand">
        <Icon name="grid" size={24} /> {t("pull.my.title")}
      </h2>
      <p className="text-[14px] text-muted">{t("pull.my.hint")}</p>
      <ul className="mt-3 space-y-2">
        {list.slice(0, 5).map((b) => (
          <PositionRow key={b.id} pos={b} shift={shifts[b.work_date]} />
        ))}
      </ul>
      <Link href="/my-position" className="mt-3 flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white font-semibold text-brand ring-1 ring-line">
        {t("mp.open")} <Icon name="next" size={18} />
      </Link>
    </Card>
  );
}

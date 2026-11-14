"use client";

// การ์ดตำแหน่งงานของพนักงาน: ตำแหน่ง คลัง กะ และเวลาพัก (ตัวใหญ่ อ่านง่ายบนมือถือ)
import { Icon } from "@/components/Icon";
import { SkillIcon } from "@/components/pull/PullUI";
import { useI18n } from "@/i18n";
import { breakHm, type MyPos, type ShiftTime } from "@/lib/my-position";

function ShiftLine({ pos, shift }: { pos: MyPos; shift?: ShiftTime }) {
  const { t, fmt } = useI18n();
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-[15px] font-semibold whitespace-nowrap text-ink">
      <Icon name={pos.shift === "morning" ? "sun" : "moon"} size={18} className="text-[#f97316]" />
      {t(pos.shift === "morning" ? "pull.my.morning" : "pull.my.night")}
      {shift?.start && <span className="num text-muted">· {fmt.time(shift.start)}–{fmt.time(shift.end)}</span>}
    </span>
  );
}

export function BreakPill({ time, size = "lg" }: { time: string | null; size?: "lg" | "sm" }) {
  const { t } = useI18n();
  const hm = breakHm(time);
  const big = size === "lg";
  return hm ? (
    <span className={`inline-flex items-center gap-2 rounded-2xl bg-[#facc15] font-bold text-[#16204a] ${big ? "px-4 py-2.5 text-[24px]" : "px-2.5 py-1 text-[14px]"}`}>
      <Icon name="clock" size={big ? 24 : 16} /> <span className="num">{t("mp.breakAt", { t: hm })}</span>
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1.5 rounded-2xl bg-paper font-semibold text-muted ring-1 ring-line ${big ? "px-4 py-2.5 text-[16px]" : "px-2.5 py-1 text-[13px]"}`}>
      <Icon name="clock" size={big ? 20 : 14} /> {t("mp.noBreak")}
    </span>
  );
}

/** การ์ดใหญ่ของกะตอนนี้ */
export function PositionHero({ pos, shift, label }: { pos: MyPos; shift?: ShiftTime; label: string }) {
  const { t } = useI18n();
  return (
    <div className="overflow-hidden rounded-[22px] bg-white ring-1 ring-line">
      <div className="flex items-center justify-between gap-2 bg-brand px-4 py-2.5 text-white">
        <span className="text-[15px] font-bold">{label}</span>
        <span className="rounded-xl bg-white/15 px-2.5 py-0.5 text-[15px] font-bold">{pos.to_code}</span>
      </div>
      <div className="p-4">
        <p className="text-[13px] text-muted">{t("mp.position")}</p>
        <div className="mt-1 flex items-center gap-3">
          <SkillIcon name={pos.skill_name} size={56} />
          <p className="min-w-0 text-[24px] leading-tight font-bold break-words text-ink">{pos.skill_name}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <ShiftLine pos={pos} shift={shift} />
          {pos.to_name && <span className="text-[14px] text-muted">{pos.to_name}</span>}
        </div>
        {pos.away && (
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-[#fff4d6] px-3 py-2 text-[15px] font-semibold text-[#6b4e00]">
            <Icon name="warehouse" size={20} className="mt-0.5 shrink-0" /> {t("mp.away", { wh: pos.to_code })}
          </p>
        )}
        <div className="mt-4">
          <BreakPill time={pos.break_time} />
        </div>
      </div>
    </div>
  );
}

/** แถวรายการวันถัดไป */
export function PositionRow({ pos, shift }: { pos: MyPos; shift?: ShiftTime }) {
  const { fmt } = useI18n();
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-line">
      <SkillIcon name={pos.skill_name} size={42} />
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-ink">{fmt.day(pos.work_date)}</span>
        <span className="block truncate text-[14px] text-ink">{pos.skill_name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <ShiftLine pos={pos} shift={shift} />
          <BreakPill time={pos.break_time} size="sm" />
        </span>
      </span>
      <span className={`shrink-0 rounded-xl px-3 py-1.5 text-lg font-bold ${pos.away ? "bg-[#f59e0b] text-white" : "bg-brand text-white"}`}>{pos.to_code}</span>
    </li>
  );
}

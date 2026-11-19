"use client";

// วิธีแก้ "หาตำแหน่งไม่ได้" ตอนลงเวลา ปรับตามเครื่องอัตโนมัติ (Android / iPhone / LINE ฯลฯ)
//   - FirstTimeLocation: การ์ดก่อนขอสิทธิ์ครั้งแรก บอกว่ามือถือจะถาม ให้กด "อนุญาต"
//   - LocationHelp: ขั้นตอนเปิดสิทธิ์/เปิด GPS เมื่อขอไม่สำเร็จ พร้อมปุ่มลองใหม่/โหลดหน้าใหม่
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/i18n";
import type { MsgKey } from "@/i18n/th";
import { chromeIntentUrl, detectPlatform, isIOS, lineExternalUrl } from "@/lib/pwa";
import { afterStep, geoSteps, guideKind, type GeoProblem, type GuideKind } from "@/lib/geo-help";

export function detectGuide(): GuideKind {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
  const touch = navigator.maxTouchPoints ?? 0;
  return guideKind(detectPlatform(navigator.userAgent, standalone, touch), isIOS(navigator.userAgent, touch));
}

/** ตัวเลือกให้สลับดูวิธีของเครื่องอื่น (เช่น หัวหน้าช่วยดูให้ลูกทีม) */
const CHOICES: GuideKind[] = ["android", "ios-safari", "ios-chrome", "line"];

const TITLE: Record<GeoProblem, MsgKey> = {
  denied: "geo.title.denied",
  off: "geo.title.off",
  timeout: "geo.title.timeout",
  none: "geo.title.none",
};

export function LocationHelp({ problem, busy, onRetry, onClose }: { problem: GeoProblem; busy?: boolean; onRetry: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<GuideKind | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- อ่านชนิดเครื่องหลัง mount (ฝั่งเซิร์ฟเวอร์ไม่มี navigator)
    setKind(detectGuide());
  }, []);
  if (!kind) return null;

  const steps = geoSteps(kind, problem) as MsgKey[];
  const after = afterStep(kind, problem);
  const choices = CHOICES.includes(kind) ? CHOICES : [kind, ...CHOICES];

  return (
    <section className="mb-3 rounded-[20px] bg-white p-4 ring-2 ring-[#f3b8b2]" aria-labelledby="geo-help-title" role="region">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#fdecea] text-bad">
          <Icon name="pin" size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p id="geo-help-title" className="text-[17px] leading-tight font-bold text-ink">{t(TITLE[problem])}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{t("geo.why")}</p>
        </div>
        <button type="button" onClick={onClose} className="-mt-1 -mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-paper" aria-label={t("common.close")}>
          <Icon name="close" size={20} />
        </button>
      </div>

      {problem !== "timeout" && problem !== "none" && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t("geo.device")}>
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setKind(c)}
              aria-pressed={c === kind}
              className={`min-h-9 rounded-full px-3 text-[13px] font-semibold ring-1 ${c === kind ? "bg-brand text-white ring-brand" : "bg-white text-brand ring-line"}`}
            >
              {t(`geo.dev.${c}` as MsgKey)}
            </button>
          ))}
        </div>
      )}

      {kind === "line" || kind === "inapp" ? (
        <p className="mt-3 text-[15px] text-ink">{t(kind === "line" ? "geo.line" : "geo.inapp")}</p>
      ) : problem === "none" ? (
        <p className="mt-3 text-[15px] text-ink">{t("geo.none")}</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {steps.map((k, i) => (
            <li key={k} className="flex items-start gap-2.5 text-[15px] leading-snug text-ink">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-[14px] font-bold text-white">{i + 1}</span>
              <span className="pt-0.5">{t(k)}</span>
            </li>
          ))}
          <li className="flex items-start gap-2.5 text-[15px] leading-snug text-ink">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ok text-white"><Icon name="check" size={16} /></span>
            <span className="pt-0.5 font-semibold">{t(after === "reload" ? "geo.after.reload" : after === "reopen" ? "geo.after.reopen" : "geo.after.retry")}</span>
          </li>
        </ol>
      )}

      <div className="mt-3 grid gap-2">
        {kind === "line" ? (
          <a href={lineExternalUrl(location.href)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand text-[17px] font-bold text-white">
            <Icon name="link" size={20} /> {t("inst.openBrowser")}
          </a>
        ) : kind === "android-samsung" ? (
          <a href={chromeIntentUrl(location.href)} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white text-[16px] font-semibold text-brand ring-1 ring-line">
            <Icon name="link" size={20} /> {t("geo.openChrome")}
          </a>
        ) : null}
        {kind !== "line" && kind !== "inapp" && problem !== "none" && (
          after === "reload" ? (
            <button type="button" onClick={() => location.reload()} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand text-[17px] font-bold text-white">
              <Icon name="history" size={20} /> {t("geo.reloadBtn")}
            </button>
          ) : (
            <button type="button" onClick={onRetry} disabled={busy} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand text-[17px] font-bold text-white disabled:opacity-60">
              <Icon name="pin" size={20} /> {t("geo.retryBtn")}
            </button>
          )
        )}
      </div>
      <p className="mt-3 text-[13px] leading-snug text-muted">{t("geo.note")}</p>
    </section>
  );
}

/** การ์ดก่อนขอสิทธิ์ครั้งแรกของเครื่องนี้ */
export function FirstTimeLocation({ busy, onAllow }: { busy?: boolean; onAllow: () => void }) {
  const { t } = useI18n();
  const [ios, setIos] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- อ่านชนิดเครื่องหลัง mount
    setIos(isIOS(navigator.userAgent, navigator.maxTouchPoints ?? 0));
  }, []);
  return (
    <section className="mb-3 rounded-[20px] bg-white p-4 ring-2 ring-[#c9d6f2]" aria-labelledby="geo-first-title">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky text-brand">
          <Icon name="pin" size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p id="geo-first-title" className="text-[17px] leading-tight font-bold text-brand">{t("geo.first.title")}</p>
          <p className="mt-1 text-[15px] leading-snug text-ink">{t(ios ? "geo.first.bodyIos" : "geo.first.body")}</p>
        </div>
      </div>
      <button type="button" onClick={onAllow} disabled={busy} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[17px] font-bold text-white disabled:opacity-60">
        <Icon name="pin" size={20} /> {t("geo.first.btn")}
      </button>
      {ios && <p className="mt-2.5 text-[13px] leading-snug text-muted">{t("geo.first.iosTip")}</p>}
    </section>
  );
}

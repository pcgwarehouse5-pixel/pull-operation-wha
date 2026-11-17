"use client";

// ปุ่ม/วิธี "ติดตั้งแอปบนมือถือ" ปรับตามเครื่องอัตโนมัติ
//   Android (Chrome / Samsung): กดปุ่มติดตั้งได้ทันที (ถ้าเบราว์เซอร์ยังไม่พร้อม แสดงวิธีผ่านเมนู ⋮)
//   iPhone / iPad (Safari): แสดง 3 ขั้นตอน ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม
//   Samsung Internet: ติดตั้งมักขึ้น "ดาวน์โหลดล้มเหลว" → ปุ่มเปิดใน Chrome (ปุ่มติดตั้งเดิมเป็นทางเลือกรอง)
//   เปิดใน LINE / Facebook: ติดตั้งไม่ได้ → ปุ่มเปิดในเบราว์เซอร์ของเครื่อง
// compact = แถบในหน้าล็อกอิน/หน้าหลัก (ปิดได้ จำไว้ 14 วัน) · ไม่ compact = การ์ดในหน้าข้อมูลของฉัน
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/i18n";
import type { MsgKey } from "@/i18n/th";
import { chromeIntentUrl, detectPlatform, lineExternalUrl, tooOld, type Platform } from "@/lib/pwa";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PwaWindow = Window & { __whaInstall?: PromptEvent | null; __whaInstalled?: boolean };
const DISMISS_KEY = "wha-install-dismissed";
const DISMISS_DAYS = 14;

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return !!at && Date.now() - at < DISMISS_DAYS * 86400000;
  } catch {
    return false;
  }
}

function readState() {
  const w = window as PwaWindow;
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true || !!w.__whaInstalled;
  return {
    platform: detectPlatform(navigator.userAgent, standalone, navigator.maxTouchPoints ?? 0),
    prompt: w.__whaInstall ?? null,
    old: tooOld(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    dismissed: dismissedRecently(),
  };
}

export function InstallApp({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [st, setSt] = useState<{ platform: Platform; prompt: PromptEvent | null; old: boolean; dismissed: boolean } | null>(null);
  const [open, setOpen] = useState(!compact);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const update = () => setSt(readState());
    update();
    window.addEventListener("wha-install-ready", update);
    return () => window.removeEventListener("wha-install-ready", update);
  }, []);

  if (!st) return null;
  const { platform, prompt, old } = st;
  const hidden = compact && st.dismissed;
  // แถบ: ไม่แสดงเมื่อติดตั้งแล้ว / ปิดไว้ / อยู่บนคอมที่ติดตั้งไม่ได้
  if (compact && (hidden || platform === "installed" || (platform === "desktop" && !prompt))) return old && compact && !hidden ? <OldNote t={t} /> : null;

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice.catch(() => null);
    (window as PwaWindow).__whaInstall = null;
    setSt(readState());
  }
  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setSt({ ...st!, dismissed: true });
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.origin);
      setCopied(true);
    } catch {}
  }

  const steps = (keys: MsgKey[], icons: ("dots" | "share" | "plus" | "download")[]) => (
    <ol className="mt-3 space-y-2">
      {keys.map((k, i) => (
        <li key={k} className="flex items-start gap-2.5 text-[15px] text-ink">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-[14px] font-bold text-white">{i + 1}</span>
          <span className="pt-0.5">
            {t(k)} <Icon name={icons[i]} size={16} className="inline align-[-2px] text-brand" />
          </span>
        </li>
      ))}
    </ol>
  );

  const body =
    platform === "installed" ? (
      <p className="mt-2 flex items-start gap-2 text-[15px] font-semibold text-ok">
        <Icon name="check" size={20} className="mt-0.5 shrink-0" /> {t("inst.installed")}
      </p>
    ) : platform === "inapp-line" ? (
      <>
        <p className="mt-2 text-[15px] text-ink">{t("inst.line")}</p>
        <a href={lineExternalUrl(location.href)} className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-white">
          <Icon name="link" size={20} /> {t("inst.openBrowser")}
        </a>
      </>
    ) : platform === "inapp-other" ? (
      <p className="mt-2 text-[15px] text-ink">{t("inst.inapp")}</p>
    ) : platform === "android-samsung" ? (
      <>
        <p className="mt-2 text-[15px] text-ink">{t("inst.samsung")}</p>
        <a href={chromeIntentUrl(location.href)} className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand text-[17px] font-bold text-white">
          <Icon name="link" size={20} /> {t("inst.openChrome")}
        </a>
        {prompt && (
          <button type="button" onClick={install} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-brand ring-1 ring-line">
            <Icon name="download" size={18} /> {t("inst.tryHere")}
          </button>
        )}
      </>
    ) : prompt ? (
      <button type="button" onClick={install} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[17px] font-bold text-white">
        <Icon name="download" size={22} /> {t("inst.install")}
      </button>
    ) : platform === "ios-safari" ? (
      open ? steps(["inst.ios1", "inst.ios2", "inst.ios3"], ["share", "plus", "plus"]) : null
    ) : platform === "ios-other" ? (
      open ? (
        <>
          <p className="mt-2 text-[15px] text-ink">{t("inst.iosOther")}</p>
          <button type="button" onClick={copyLink} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-brand ring-1 ring-line">
            <Icon name="link" size={18} /> {copied ? t("inst.copied") : t("inst.copy")}
          </button>
        </>
      ) : null
    ) : platform === "android" ? (
      open ? steps(["inst.android1", "inst.android2", "inst.android3"], ["dots", "download", "plus"]) : null
    ) : (
      <p className="mt-2 text-[15px] text-muted">{t("inst.desktop")}</p>
    );

  const canToggle = compact && !prompt && (platform === "ios-safari" || platform === "ios-other" || platform === "android");

  return (
    <section className={`rounded-[20px] bg-white p-4 ring-1 ${compact ? "mb-4 ring-[#c9d6f2]" : "ring-line"}`} aria-label={t("inst.title")}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky text-brand">
          <Icon name="phone" size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] leading-tight font-bold text-brand">{t("inst.title")}</p>
          {platform !== "installed" && <p className="mt-0.5 text-[13px] leading-snug text-muted">{t("inst.desc")}</p>}
        </div>
        {compact && (
          <button type="button" onClick={dismiss} className="-mt-1 -mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-paper" aria-label={t("inst.later")}>
            <Icon name="close" size={20} />
          </button>
        )}
      </div>
      {body}
      {canToggle && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-white">
          <Icon name="download" size={20} /> {t("inst.how")}
        </button>
      )}
      {old && <OldNote t={t} inline />}
    </section>
  );
}

function OldNote({ t, inline }: { t: (k: MsgKey) => string; inline?: boolean }) {
  return (
    <p className={`flex items-start gap-2 rounded-xl bg-[#fff4d6] px-3 py-2 text-[14px] text-[#6b4e00] ${inline ? "mt-3" : "mb-4"}`} role="status">
      <Icon name="alert" size={18} className="mt-0.5 shrink-0" /> {t("inst.old")}
    </p>
  );
}

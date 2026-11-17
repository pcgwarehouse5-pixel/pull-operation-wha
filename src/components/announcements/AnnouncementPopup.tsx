"use client";

// ป๊อปอัปประชาสัมพันธ์: เด้งทุกครั้งที่เปิดแอป (ครั้งเดียวต่อการเปิด ย้ายหน้าในแอปไม่เด้งซ้ำ) ให้ทุกคนทุกคลัง
// แตะภาพ → ลิงก์เว็บ (แท็บใหม่) หรือ หน้าเมนูในแอป · ปุ่มปิด · หลายประกาศเลื่อนดูได้
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AuthProvider";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/i18n";
import { todayIso } from "@/lib/shifts";
import { ANN_SESSION_KEY, validMenuPath, validUrl, type AnnouncementView } from "@/lib/announcements";
import { loadShowingToday } from "./data";

export function AnnouncementPopup() {
  const { demo } = useApp();
  const [list, setList] = useState<AnnouncementView[]>([]);

  useEffect(() => {
    let shown = false;
    try {
      shown = sessionStorage.getItem(ANN_SESSION_KEY) === "1";
    } catch {}
    if (shown) return;
    let live = true;
    (async () => {
      const today = todayIso();
      const items = demo ? demo.previewAnnouncements(today).filter((a) => a.starts_on <= today && today <= a.ends_on) : await loadShowingToday(today).catch(() => []);
      if (!live) return;
      try {
        sessionStorage.setItem(ANN_SESSION_KEY, "1");
      } catch {}
      setList(items.filter((a) => a.image_url));
    })();
    return () => {
      live = false;
    };
  }, [demo]);

  if (!list.length) return null;
  return <AnnouncementModal list={list} onClose={() => setList([])} />;
}

/** หน้าต่างประกาศ (ใช้ทั้งป๊อปอัปจริง และปุ่ม "ดูตัวอย่าง" ในหน้าจัดการ) */
export function AnnouncementModal({ list, onClose, start = 0 }: { list: AnnouncementView[]; onClose: () => void; start?: number }) {
  const router = useRouter();
  const { t } = useI18n();
  const [i, setI] = useState(Math.min(start, list.length - 1));
  const a = list[i];
  const url = a.link_type === "url" ? validUrl(a.link_url ?? "") : null;
  const menu = a.link_type === "menu" && validMenuPath(a.link_menu) ? a.link_menu : null;
  const many = list.length > 1;

  const go = useCallback(() => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else if (menu) {
      onClose();
      router.push(menu);
    }
  }, [url, menu, onClose, router]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && many) setI((n) => (n + 1) % list.length);
      if (e.key === "ArrowLeft" && many) setI((n) => (n - 1 + list.length) % list.length);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, many, list.length]);

  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- ภาพจากที่เก็บแบบปิด (ลิงก์ชั่วคราว) ไม่ผ่านตัวย่อภาพของ Next
    <img src={a.image_url ?? ""} alt={a.title} className="block max-h-popup-img w-full bg-white object-contain" />
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0b1433]/75 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={a.title}>
      <div className="relative w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white text-ink shadow-lg ring-1 ring-line"
          aria-label={t("ann.close")}
        >
          <Icon name="close" size={26} />
        </button>

        <div className="overflow-hidden rounded-[22px] bg-white shadow-2xl">
          {url || menu ? (
            <button type="button" onClick={go} className="block w-full cursor-pointer" aria-label={`${a.title} · ${t("ann.tapHint")}`}>
              {image}
            </button>
          ) : (
            image
          )}
        </div>

        <p className="mt-3 text-center text-[16px] font-semibold text-white">{a.title}</p>
        {(url || menu) && (
          <button type="button" onClick={go} className="mx-auto mt-1 flex items-center gap-1 text-[14px] text-white/85 underline-offset-2 hover:underline">
            <Icon name={url ? "link" : "next"} size={16} /> {t("ann.tapHint")}
          </button>
        )}

        {many && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button type="button" onClick={() => setI((n) => (n - 1 + list.length) % list.length)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white" aria-label={t("ann.prev")}>
              <Icon name="back" size={22} />
            </button>
            <span className="flex gap-1.5" aria-label={t("ann.of", { a: i + 1, b: list.length })}>
              {list.map((x, k) => (
                <span key={x.id} className={`h-2.5 rounded-full transition-all ${k === i ? "w-6 bg-white" : "w-2.5 bg-white/45"}`} />
              ))}
            </span>
            <button type="button" onClick={() => setI((n) => (n + 1) % list.length)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white" aria-label={t("ann.next")}>
              <Icon name="next" size={22} />
            </button>
          </div>
        )}

        <button type="button" onClick={onClose} className="mx-auto mt-4 flex min-h-12 w-full max-w-[220px] items-center justify-center rounded-2xl bg-white text-[17px] font-bold text-brand">
          {t("ann.close")}
        </button>
      </div>
    </div>
  );
}

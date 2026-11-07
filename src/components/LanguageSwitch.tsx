"use client";

// ปุ่มสลับภาษา ไทย | မြန်မာ
import { useI18n, type Locale } from "@/i18n";

export function LanguageSwitch({ onDark }: { onDark?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const opts: Locale[] = ["th", "my"];
  return (
    <div role="radiogroup" aria-label={t("lang.label")} className={`inline-flex shrink-0 rounded-full p-0.5 ${onDark ? "bg-white/12 ring-1 ring-white/25" : "bg-white ring-1 ring-line"}`}>
      {opts.map((l) => {
        const on = locale === l;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            lang={l}
            onClick={() => setLocale(l)}
            className={`min-h-9 rounded-full px-3 text-[14px] font-semibold transition ${
              on ? (onDark ? "bg-white text-brand" : "bg-brand text-white") : onDark ? "text-white/85 hover:text-white" : "text-muted hover:text-brand"
            }`}
          >
            {t(l === "th" ? "lang.th" : "lang.my")}
          </button>
        );
      })}
    </div>
  );
}

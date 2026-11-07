"use client";

// ระบบ 2 ภาษา: ไทย (ค่าเริ่มต้น) / พม่า — จำภาษาที่เลือกไว้ในเครื่อง
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { th, type MsgKey } from "./th";
import { my } from "./my";

export type Locale = "th" | "my";
const DICT: Record<Locale, Record<MsgKey, string>> = { th, my };
const KEY = "wha-locale";
const TZ = "Asia/Bangkok";

const TH_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
// วันในสัปดาห์แบบย่อที่ใช้ในปฏิทินพม่า (อาทิตย์ → เสาร์)
const MY_DAYS = ["နွေ", "လာ", "ဂါ", "ဟူး", "တေး", "ကြာ", "နေ"];
const MY_MONTHS = ["ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ", "နိုဝင်ဘာ", "ဒီဇင်ဘာ"];

type Vars = Record<string, string | number>;
export type T = (key: MsgKey, vars?: Vars) => string;

function fill(s: string, vars?: Vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

const ymdParts = (ymd: string) => ymd.split("-").map(Number) as [number, number, number];
const weekdayOf = (ymd: string) => {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const local = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { ymd: `${g("year")}-${g("month")}-${g("day")}`, hm: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
};

export function makeFmt(locale: Locale) {
  const days = locale === "my" ? MY_DAYS : TH_DAYS;
  return {
    days,
    /** "ศ. 6 พ.ย." / "ကြာ 6 နိုဝင်ဘာ" */
    day(ymd: string) {
      const [, m, d] = ymdParts(ymd);
      return locale === "my" ? `${MY_DAYS[weekdayOf(ymd)]} ${d} ${MY_MONTHS[m - 1]}` : `${TH_DAYS[weekdayOf(ymd)]} ${d} ${TH_MONTHS_SHORT[m - 1]}`;
    },
    /** "6 พฤศจิกายน 2569" / "6 နိုဝင်ဘာ 2026" */
    date(ymd: string) {
      const [y, m, d] = ymdParts(ymd);
      return locale === "my" ? `${d} ${MY_MONTHS[m - 1]} ${y}` : `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
    },
    /** "พฤศจิกายน 2569" / "နိုဝင်ဘာ 2026" */
    month(ym: string) {
      const [y, m] = ymdParts(`${ym}-01`);
      return locale === "my" ? `${MY_MONTHS[m - 1]} ${y}` : `${TH_MONTHS[m - 1]} ${y + 543}`;
    },
    /** เวลา HH:MM ตามเวลาไทย */
    time(iso: string | null | undefined) {
      return iso ? local(iso).hm : "-";
    },
    /** "6 พ.ย. 10:00" */
    dateTime(iso: string) {
      const l = local(iso);
      const [, m, d] = ymdParts(l.ymd);
      return `${d} ${locale === "my" ? MY_MONTHS[m - 1] : TH_MONTHS_SHORT[m - 1]} ${l.hm}`;
    },
    year(y: number) {
      return locale === "my" ? String(y) : String(y + 543);
    },
  };
}
export type Fmt = ReturnType<typeof makeFmt>;

type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: T; fmt: Fmt };
const I18n = createContext<Ctx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("th");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ภาษาที่จำไว้ในเครื่อง อ่านได้หลังหน้าโหลด
    if (saved === "my") setLocaleState("my");
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {}
  }, []);

  const value = useMemo<Ctx>(() => {
    const d = DICT[locale];
    return { locale, setLocale, t: (k, v) => fill(d[k] ?? th[k], v), fmt: makeFmt(locale) };
  }, [locale, setLocale]);

  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useI18n(): Ctx {
  const v = useContext(I18n);
  if (!v) throw new Error("useI18n ต้องใช้ภายใน LocaleProvider");
  return v;
}

/** แปลข้อความผิดพลาดที่รู้จัก (จากฐานข้อมูล/ระบบ) เป็นภาษาที่เลือก ไม่รู้จัก = คงข้อความเดิม */
export function localizeError(msg: string, t: T): string {
  let m: RegExpMatchArray | null;
  if (/Invalid login credentials|รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง/i.test(msg)) return t("err.login");
  if (/Failed to fetch|NetworkError|Load failed|เชื่อมต่อไม่ได้/i.test(msg)) return t("err.network");
  if (/row-level security|permission denied|ไม่มีสิทธิ์ทำรายการนี้/i.test(msg)) return t("err.permission");
  if ((m = msg.match(/นอกพื้นที่คลัง \(ห่าง (\d+) เมตร ต้องอยู่ในรัศมี (\d+) เมตร\)/))) return t("err.outside", { m: m[1], r: m[2] });
  if ((m = msg.match(/GPS ยังไม่แม่นพอ \(คลาดเคลื่อนประมาณ (\d+) เมตร\)/))) return t("err.gpsWeak", { m: m[1] });
  if (/บันทึกเข้างานแล้ว/.test(msg)) return t("err.alreadyIn");
  if (/บันทึกออกงานไปแล้ว/.test(msg)) return t("err.alreadyOut");
  if (/ยังไม่ได้ตั้งพิกัด/.test(msg)) return t("err.noCoords");
  if (/มีใบลาในช่วงวันที่นี้อยู่แล้ว/.test(msg)) return t("err.overlap");
  if (/รออนุมัติอยู่แล้ว/.test(msg)) return t("err.pendingFix");
  if (/ไม่มีวันทำงาน/.test(msg)) return t("lf.noWorkDays");
  if (/duplicate key/i.test(msg)) return t("err.duplicate");
  return msg;
}

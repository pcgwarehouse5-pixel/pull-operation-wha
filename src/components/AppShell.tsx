"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useApp } from "./AuthProvider";
import { Icon } from "./Icon";
import { NotificationBell } from "./NotificationBell";
import { LanguageSwitch } from "./LanguageSwitch";
import { LogoMark } from "./LogoMark";
import { ROLE_RANK, fullName, type AppRole } from "@/lib/types";
import { activeKey, bottomKeys, navFor, type NavItem } from "@/lib/nav";
import { useI18n } from "@/i18n";
import type { MsgKey } from "@/i18n/th";

/** หน้าปุยนุ่นในวงกลมขาว (ใช้เป็นรูปคู่ชื่อผู้ใช้ในหน้ารวมเมนู · โลโก้แอปอยู่ที่ LogoMark) */
export function Mark({ size = 40 }: { size?: number }) {
  return (
    <span className="relative inline-block shrink-0 overflow-hidden rounded-full bg-white ring-2 ring-white" style={{ width: size, height: size }}>
      <Image src="/mascot/happy.jpg" alt="" width={size * 2} height={Math.round(size * 2 * 1.53)} className="absolute top-[-6%] left-1/2 max-w-none -translate-x-1/2" style={{ width: size * 1.55 }} aria-hidden="true" />
    </span>
  );
}

export function Logo({ onDark, compact }: { onDark?: boolean; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="flex items-center gap-2.5">
      {/* บนพื้นกรมท่า ใส่ขอบจางๆ ให้กรอบไอคอนไม่กลืนกับพื้น */}
      <LogoMark size={40} className={onDark ? "rounded-[9px] ring-1 ring-white/30" : ""} />
      <span className={`leading-tight ${onDark ? "text-white" : "text-brand"}`}>
        <span className="block text-[17px] font-bold tracking-tight">{t("app.name")}</span>
        {!compact && <span className={`block text-[12px] ${onDark ? "text-white/70" : "text-muted"}`}>{t("app.tagline")}</span>}
      </span>
    </span>
  );
}

// แถบแดง-ขาว แบบขอบเสื้อโปโลของปุยนุ่น
function Piping({ vertical }: { vertical?: boolean }) {
  return vertical ? (
    <span className="absolute inset-y-0 right-0 flex w-[5px] gap-[2px]" aria-hidden="true">
      <span className="w-[2px] bg-white/25" />
      <span className="w-[3px] bg-piping" />
    </span>
  ) : (
    <span className="absolute inset-x-0 bottom-0 flex h-[5px] flex-col gap-[2px]" aria-hidden="true">
      <span className="h-[2px] bg-white/25" />
      <span className="h-[3px] bg-piping" />
    </span>
  );
}

export function AppShell({
  title,
  children,
  wide,
  back = "/",
  actions,
  minRole,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
  back?: string | null;
  actions?: ReactNode;
  minRole?: AppRole; // บทบาทขั้นต่ำที่เปิดหน้านี้ได้ (ข้อมูลยังถูกกันซ้ำด้วยกฎในฐานข้อมูล)
}) {
  const { profile, signOut, preview } = useApp();
  const { t } = useI18n();
  const allowed = !minRole || ROLE_RANK[profile.role] >= ROLE_RANK[minRole];
  const pathname = usePathname();
  const groups = navFor(profile.role);
  const all = groups.flatMap((g) => g.items);
  const active = activeKey(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const home = pathname === "/";
  const width = wide ? "max-w-6xl" : "max-w-3xl";
  const name = profile.nickname ? `${profile.first_name_th} (${profile.nickname})` : fullName(profile);
  const role = t(`role.${profile.role}` as MsgKey);
  const label = (i: NavItem) => t(`nav.${i.key}` as MsgKey);
  const short = (i: NavItem) => (i.short ? t(`nav.${i.key}.short` as MsgKey) : label(i));
  const desc = (i: NavItem) => t(`nav.${i.key}.desc` as MsgKey);

  return (
    <div className="min-h-screen bg-paper lg:pl-[17rem]">
      {preview && (
        <div className="sticky top-0 z-[60] bg-warn px-3 py-1 text-center text-[13px] font-semibold text-ink print:hidden">
          {t("common.previewBanner", { role })}
        </div>
      )}

      {/* แถบเมนูด้านซ้าย (จอใหญ่) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[17rem] flex-col bg-brand text-white lg:flex print:hidden">
        <Piping vertical />
        <div className="px-5 pt-5 pb-4">
          <Link href="/" className="rounded-lg">
            <Logo onDark />
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label={t("common.menu")}>
          {groups.map((g) => (
            <div key={g.id} className="mb-5">
              <p className="mb-1.5 px-3 text-[13px] font-semibold text-white/55">{t(`nav.group.${g.id}` as MsgKey)}</p>
              <ul className="space-y-0.5">
                {g.items.map((i) => {
                  const on = active === i.key;
                  return (
                    <li key={i.key}>
                      <Link
                        href={i.href}
                        aria-current={on ? "page" : undefined}
                        className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition ${on ? "bg-white font-semibold text-brand" : "text-white/85 hover:bg-white/10"}`}
                      >
                        <Icon name={i.icon} size={20} className={on ? "text-brand" : "text-white/65"} />
                        {label(i)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3 pr-5">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[15px] font-semibold">{name}</p>
            <p className="text-[12px] text-white/65">{role}</p>
          </div>
          <button onClick={signOut} className="rounded-lg p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label={t("common.logout")} title={t("common.logout")}>
            <Icon name="logout" size={20} />
          </button>
        </div>
      </aside>

      {/* แถบหัว: มือถือ = กรมท่า + แถบแดงขอบเสื้อ / จอใหญ่ = พื้นสว่าง */}
      <header className="sticky top-0 z-30 bg-brand text-white lg:bg-paper/95 lg:text-ink lg:backdrop-blur print:hidden">
        <div className={`relative mx-auto flex min-h-[60px] items-center gap-2 px-3 pb-[5px] sm:px-4 lg:pb-0 ${width}`}>
          {home ? (
            <span className="min-w-0 flex-1 lg:hidden">
              <Logo onDark compact />
            </span>
          ) : (
            <>
              {back && (
                <Link href={back} className="-ml-1 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-white/90 hover:bg-white/10 lg:text-brand lg:hover:bg-brand/5" aria-label={t("common.back")}>
                  <Icon name="back" />
                </Link>
              )}
              <p className="min-w-0 flex-1 truncate pl-1 text-[17px] font-semibold lg:text-[15px] lg:font-medium lg:text-muted">{title}</p>
            </>
          )}
          {home && <span className="hidden flex-1 lg:block" />}
          {actions}
          <span className="lg:hidden">
            <LanguageSwitch onDark />
          </span>
          <span className="hidden lg:inline-flex">
            <LanguageSwitch />
          </span>
          <NotificationBell />
        </div>
        <span className="lg:hidden">
          <Piping />
        </span>
      </header>

      <main className={`mx-auto px-3 pt-4 pb-28 sm:px-4 lg:pb-12 ${width}`}>
        {allowed ? (
          children
        ) : (
          <div className="rounded-2xl bg-[#fff6d6] px-4 py-3 text-[#6b4e00]" role="status">
            {t("common.forRole", { role: t(`role.${minRole!}` as MsgKey) })}{" "}
            <Link href="/" className="font-semibold underline">{t("common.goHome")}</Link>
          </div>
        )}
      </main>

      {/* แถบล่าง (มือถือ) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/96 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden" aria-label={t("common.menu")}>
        <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${bottomKeys(profile.role).length + 1}, minmax(0, 1fr))` }}>
          {bottomKeys(profile.role).map((k) => {
            const i = all.find((x) => x.key === k);
            if (!i) return null;
            const on = active === k;
            return (
              <li key={k}>
                <Link href={i.href} aria-current={on ? "page" : undefined} className={`flex min-h-[62px] flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[12px] leading-tight ${on ? "font-bold text-brand" : "text-muted"}`}>
                  <span className={`flex h-8 w-12 items-center justify-center rounded-[10px] ${on ? "bg-brand text-white" : ""}`}>
                    <Icon name={i.icon} size={21} />
                  </span>
                  <span className="line-clamp-1">{short(i)}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button onClick={() => setMenuOpen(true)} className={`flex min-h-[62px] w-full flex-col items-center justify-center gap-0.5 text-[12px] ${menuOpen ? "font-bold text-brand" : "text-muted"}`}>
              <span className="flex h-8 w-12 items-center justify-center rounded-[10px]">
                <Icon name="grid" size={21} />
              </span>
              {t("common.menu")}
            </button>
          </li>
        </ul>
      </nav>

      {/* หน้ารวมเมนู (มือถือ) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-[#0b1433]/55 lg:hidden" onClick={() => setMenuOpen(false)} role="dialog" aria-modal="true" aria-label={t("common.allMenu")}>
          <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[28px] bg-paper pb-[max(16px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="relative flex items-center gap-3 rounded-t-[28px] bg-brand px-5 pt-4 pb-5 text-white">
              <Mark size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{name}</p>
                <p className="text-sm text-white/75">{role}</p>
              </div>
              <button onClick={() => setMenuOpen(false)} className="rounded-full p-2 text-white/80 hover:bg-white/10" aria-label={t("common.closeMenu")}>
                <Icon name="close" />
              </button>
              <Piping />
            </div>
            <div className="space-y-4 px-4 pt-4">
              {groups.map((g) => (
                <section key={g.id}>
                  <h2 className="mb-2 px-1 text-sm font-bold text-muted">{t(`nav.group.${g.id}` as MsgKey)}</h2>
                  <ul className="grid grid-cols-2 gap-2">
                    {g.items.map((i) => (
                      <li key={i.key}>
                        <Link
                          href={i.href}
                          onClick={() => setMenuOpen(false)}
                          className={`flex h-full min-h-[92px] flex-col gap-1 rounded-[18px] bg-white p-3 ring-1 ${active === i.key ? "ring-2 ring-brand" : "ring-line"}`}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky text-brand">
                            <Icon name={i.icon} size={20} />
                          </span>
                          <span className="leading-tight font-semibold text-ink">{label(i)}</span>
                          <span className="text-[12px] leading-snug text-muted">{desc(i)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <button onClick={signOut} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-bad ring-1 ring-line">
                <Icon name="logout" size={20} /> {t("common.logout")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

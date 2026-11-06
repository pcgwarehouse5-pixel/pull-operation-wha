"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useApp } from "./AuthProvider";
import { Icon } from "./Icon";
import { NotificationBell } from "./NotificationBell";
import { ROLE_LABEL, ROLE_RANK, fullName, type AppRole } from "@/lib/types";
import { activeKey, bottomKeys, navFor } from "@/lib/nav";

export function Logo({ onDark }: { onDark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-[15px] font-black ${onDark ? "bg-white text-brand" : "bg-brand text-white"}`}>W</span>
      <span className={`leading-tight ${onDark ? "text-white" : "text-brand"}`}>
        <span className="block text-[16px] font-bold">WHA Workforce</span>
        <span className={`block text-[12px] ${onDark ? "text-white/70" : "text-muted"}`}>บริหารพนักงานคลังสินค้า</span>
      </span>
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
  const allowed = !minRole || ROLE_RANK[profile.role] >= ROLE_RANK[minRole];
  const pathname = usePathname();
  const groups = navFor(profile.role);
  const all = groups.flatMap((g) => g.items);
  const active = activeKey(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const home = pathname === "/";
  const width = wide ? "max-w-6xl" : "max-w-3xl";
  const name = profile.nickname ? `${profile.first_name_th} (${profile.nickname})` : fullName(profile);

  return (
    <div className="min-h-screen bg-paper lg:pl-64">
      {preview && (
        <div className="sticky top-0 z-[60] bg-warn px-3 py-1 text-center text-[13px] font-semibold text-ink print:hidden">
          โหมดดูดีไซน์ (ข้อมูลสมมติ) · {ROLE_LABEL[profile.role]}
        </div>
      )}

      {/* แถบเมนูด้านซ้าย (จอใหญ่) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-brand text-white lg:flex print:hidden">
        <div className="px-5 pt-5 pb-4">
          <Link href="/" className="rounded-lg">
            <Logo onDark />
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="เมนูหลัก">
          {groups.map((g) => (
            <div key={g.title} className="mb-5">
              <p className="mb-1.5 px-3 text-[13px] font-semibold text-white/55">{g.title}</p>
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
                        <Icon name={i.icon} size={20} className={on ? "text-brand" : "text-white/70"} />
                        {i.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[15px] font-semibold">{name}</p>
            <p className="text-[12px] text-white/65">{ROLE_LABEL[profile.role]}</p>
          </div>
          <button onClick={signOut} className="rounded-lg p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <Icon name="logout" size={20} />
          </button>
        </div>
      </aside>

      {/* แถบหัว (มือถือ) / แถบชื่อหน้า (จอใหญ่) */}
      <header className="sticky top-0 z-30 bg-brand text-white lg:bg-paper lg:text-ink print:hidden">
        <div className={`mx-auto flex min-h-[56px] items-center gap-2 px-3 sm:px-4 ${width}`}>
          {home ? (
            <span className="flex-1 lg:hidden">
              <Logo onDark />
            </span>
          ) : (
            <>
              {back && (
                <Link href={back} className="-ml-1 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-white/90 hover:bg-white/10 lg:text-brand lg:hover:bg-brand/5" aria-label="ย้อนกลับ">
                  <Icon name="back" />
                </Link>
              )}
              <h1 className="min-w-0 flex-1 truncate pl-1 text-[17px] font-semibold lg:text-[15px] lg:font-medium lg:text-muted">{title}</h1>
            </>
          )}
          {home && <span className="hidden flex-1 lg:block" />}
          {actions}
          <NotificationBell />
        </div>
      </header>

      <main className={`mx-auto px-3 pt-4 pb-28 sm:px-4 lg:pb-12 ${width}`}>
        {allowed ? (
          children
        ) : (
          <div className="rounded-r-xl border-l-4 border-warn bg-[#fdf5e2] px-4 py-3 text-[#6d4a0c]" role="status">
            หน้านี้สำหรับ{ROLE_LABEL[minRole!]}ขึ้นไป{" "}
            <Link href="/" className="font-semibold underline">กลับหน้าหลัก</Link>
          </div>
        )}
      </main>

      {/* แถบปุ่มล่าง (มือถือ) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden" aria-label="เมนูหลัก">
        <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${bottomKeys(profile.role).length + 1}, minmax(0, 1fr))` }}>
          {bottomKeys(profile.role).map((k) => {
            const i = all.find((x) => x.key === k);
            if (!i) return null;
            const on = active === k;
            return (
              <li key={k}>
                <Link href={i.href} aria-current={on ? "page" : undefined} className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[12px] ${on ? "font-bold text-brand" : "text-muted"}`}>
                  <span className={`flex h-8 w-12 items-center justify-center rounded-full ${on ? "bg-[#eaf0fb]" : ""}`}>
                    <Icon name={i.icon} />
                  </span>
                  {i.short ?? i.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button onClick={() => setMenuOpen(true)} className={`flex min-h-[60px] w-full flex-col items-center justify-center gap-0.5 text-[12px] ${menuOpen ? "font-bold text-brand" : "text-muted"}`}>
              <span className="flex h-8 w-12 items-center justify-center rounded-full">
                <Icon name="grid" />
              </span>
              เมนู
            </button>
          </li>
        </ul>
      </nav>

      {/* หน้ารวมเมนู (มือถือ) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-[#0b1530]/50 lg:hidden" onClick={() => setMenuOpen(false)} role="dialog" aria-modal="true" aria-label="เมนูทั้งหมด">
          <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-3xl bg-paper pb-[max(16px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 rounded-t-3xl bg-white px-5 pt-4 pb-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold text-brand">{name}</p>
                <p className="text-sm text-muted">{ROLE_LABEL[profile.role]}</p>
              </div>
              <button onClick={() => setMenuOpen(false)} className="rounded-full p-2 text-muted hover:bg-paper" aria-label="ปิดเมนู">
                <Icon name="close" />
              </button>
            </div>
            <div className="space-y-4 px-4 pt-4">
              {groups.map((g) => (
                <section key={g.title}>
                  <h2 className="mb-2 px-1 text-sm font-bold text-muted">{g.title}</h2>
                  <ul className="grid grid-cols-2 gap-2">
                    {g.items.map((i) => (
                      <li key={i.key}>
                        <Link
                          href={i.href}
                          onClick={() => setMenuOpen(false)}
                          className={`flex h-full min-h-[92px] flex-col gap-1 rounded-2xl bg-white p-3 ring-1 ${active === i.key ? "ring-2 ring-brand" : "ring-line"}`}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eaf0fb] text-brand">
                            <Icon name={i.icon} size={20} />
                          </span>
                          <span className="font-semibold leading-tight text-ink">{i.label}</span>
                          <span className="text-[12px] leading-snug text-muted">{i.desc}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <button onClick={signOut} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-bad ring-1 ring-line">
                <Icon name="logout" size={20} /> ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

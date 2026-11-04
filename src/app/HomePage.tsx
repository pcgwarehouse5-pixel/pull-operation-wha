"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Card } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { navFor } from "@/lib/nav";
import { ROLE_LABEL, isGlobal } from "@/lib/types";

export default function HomePage() {
  const { profile, warehouses, myWarehouseIds } = useApp();
  const mine = warehouses.filter((w) => myWarehouseIds.includes(w.id));
  const items = navFor(profile.role)
    .flatMap((g) => g.items)
    .filter((i) => i.key !== "home");

  return (
    <AppShell title="หน้าหลัก">
      <Card className="mb-4">
        <p className="text-muted">สวัสดี</p>
        <p className="text-2xl font-bold text-brand">
          {profile.first_name_th} {profile.last_name_th ?? ""}
          {profile.nickname && <span className="text-lg font-semibold text-muted"> ({profile.nickname})</span>}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-[15px]">
          <div>
            <dt className="text-muted">บทบาท</dt>
            <dd className="font-semibold">{ROLE_LABEL[profile.role]}</dd>
          </div>
          <div>
            <dt className="text-muted">คลัง</dt>
            <dd className="font-semibold">{isGlobal(profile.role) ? "ทุกคลัง" : mine.map((w) => w.code).join(", ") || "-"}</dd>
          </div>
        </dl>
      </Card>

      <h2 className="mb-2 px-1 text-sm font-bold text-muted">เมนู</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="flex h-full min-h-[110px] flex-col gap-1.5 rounded-2xl bg-white p-4 ring-1 ring-line hover:ring-brand/40">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eaf0fb] text-brand">
                <Icon name={i.icon} />
              </span>
              <span className="font-semibold leading-tight">{i.label}</span>
              <span className="text-[13px] leading-snug text-muted">{i.desc}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-center text-[14px] text-muted">ลงเวลา ตารางกะ ลา OT และรายงาน จะเพิ่มในโมดูลถัดไป</p>
    </AppShell>
  );
}

"use client";

// แถบกำลังโหลดด้านบนจอ: ขึ้นทันทีที่กดลิงก์ในแอป จนกว่าหน้าใหม่จะเปิด (เน็ตช้าจะได้รู้ว่ากดติดแล้ว)
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { navTargetPath } from "@/lib/nav-progress";

const GIVE_UP_MS = 10000; // เผื่อการเปลี่ยนหน้าถูกยกเลิก แถบจะได้ไม่ค้าง

export function NavProgress() {
  const pathname = usePathname();
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- หน้าเปลี่ยนแล้ว เก็บแถบ
    setFrom(null);
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!a) return;
      const to = navTargetPath(a.getAttribute("href"), window.location.href, e, a.target, a.hasAttribute("download"));
      if (to) setFrom(window.location.pathname);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!from) return;
    const t = setTimeout(() => setFrom(null), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [from]);

  return from === pathname ? <div className="nav-progress" aria-hidden="true" /> : null;
}

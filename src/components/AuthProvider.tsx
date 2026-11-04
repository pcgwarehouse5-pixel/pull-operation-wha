"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { errText, sb } from "@/lib/supabase";
import type { AppRole, Profile, Warehouse } from "@/lib/types";
import { loadPreviewData, previewRole, type PreviewData } from "@/lib/preview";
import { Alert, Button, Loading } from "./ui";

type AppCtx = {
  session: Session;
  profile: Profile;
  warehouses: Warehouse[]; // ทุกคลัง (รวมที่ปิดใช้งาน)
  myWarehouseIds: string[]; // คลังหลัก + คลังเพิ่มเติมของฉัน
  preview: boolean;
  demo: PreviewData | null; // ข้อมูลสมมติ (มีเฉพาะโหมดดูดีไซน์ตอนพัฒนา)
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp ต้องใช้ภายใน AuthProvider");
  return v;
}

const PUBLIC_PATHS = ["/login"];
const CHANGE_PASSWORD = "/change-password";

type Loaded = { uid: string; profile: Profile | null; warehouses: Warehouse[]; myWarehouseIds: string[] };

// ค่าที่ขึ้นต้นด้วย NEXT_PUBLIC_ ถูกฝังตอน build จึงรู้ได้ทันทีว่าตั้งค่าครบไหม
const CONFIG_ERROR =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? ""
    : "ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY";

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ role: AppRole; data: PreviewData } | null>(null);

  // อ่านโหมดดูดีไซน์จาก URL/เบราว์เซอร์ (มีเฉพาะฝั่งเบราว์เซอร์ จึงต้องอ่านหลังหน้าโหลด)
  useEffect(() => {
    const role = previewRole();
    const pending = role ? loadPreviewData() : null;
    if (!role || !pending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ค่าจาก URL และ sessionStorage
      setPreview(null);
      return;
    }
    let live = true;
    pending.then((data) => live && setPreview({ role, data }));
    return () => {
      live = false;
    };
  }, [pathname]);

  useEffect(() => {
    if (CONFIG_ERROR) return;
    const client = sb();
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = client.auth.onAuthStateChange((_ev, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async (uid: string) => {
    const c = sb();
    const [p, w, uw] = await Promise.all([
      c.from("profiles").select("*").eq("id", uid).maybeSingle(),
      c.from("warehouses").select("*").order("code"),
      c.from("user_warehouses").select("warehouse_id").eq("user_id", uid),
    ]);
    const err = p.error || w.error || uw.error;
    if (err) throw err;
    const profile = p.data as Profile | null;
    const extra = (uw.data ?? []).map((r: { warehouse_id: string }) => r.warehouse_id);
    setLoaded({
      uid,
      profile,
      warehouses: (w.data ?? []) as Warehouse[],
      myWarehouseIds: [...new Set([profile?.warehouse_id, ...extra].filter(Boolean) as string[])],
    });
  }, []);

  // ยังไม่ล็อกอิน → ไปหน้าล็อกอิน
  useEffect(() => {
    if (session === null && !previewRole() && !PUBLIC_PATHS.includes(pathname)) router.replace("/login");
  }, [session, pathname, router]);

  const userKey = session === undefined ? "checking" : session ? session.user.id : "signed-out";
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลผู้ใช้จาก Supabase หลังล็อกอิน
    load(session.user.id).catch((e) => !cancelled && setError(errText(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);

  // ใช้ข้อมูลเฉพาะของผู้ใช้ที่ล็อกอินอยู่ตอนนี้ (ออกจากระบบ/สลับบัญชีแล้วไม่ค้างของเก่า)
  const data = session && loaded?.uid === session.user.id ? loaded : null;

  const signOut = useCallback(async () => {
    await sb().auth.signOut();
    router.replace("/login");
  }, [router]);

  // ยังใช้รหัสผ่านเริ่มต้นอยู่ → ต้องตั้งรหัสใหม่ก่อนใช้งานทุกหน้า
  const mustChange = !!data?.profile?.must_change_password;
  useEffect(() => {
    if (mustChange && pathname !== CHANGE_PASSWORD) router.replace(CHANGE_PASSWORD);
  }, [mustChange, pathname, router]);

  if (process.env.NODE_ENV === "development" && preview && !PUBLIC_PATHS.includes(pathname)) {
    const me = preview.data.previewProfile(preview.role);
    return (
      <Ctx.Provider
        value={{
          session: {} as Session,
          profile: me,
          warehouses: preview.data.PREVIEW_WAREHOUSES,
          myWarehouseIds: me.warehouse_id ? [me.warehouse_id] : [],
          preview: true,
          demo: preview.data,
          reload: async () => {},
          signOut: async () => {},
        }}
      >
        {children}
      </Ctx.Provider>
    );
  }

  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;
  if (CONFIG_ERROR) return <Centered><Alert tone="error">{CONFIG_ERROR}</Alert></Centered>;
  if (error)
    return (
      <Centered>
        <Alert tone="error">{error}</Alert>
        <Button className="mt-4 w-full" onClick={() => location.reload()}>ลองใหม่</Button>
      </Centered>
    );
  if (!session || !data) return <Loading />;
  if (!data.profile)
    return (
      <Centered>
        <Alert tone="warning">บัญชีนี้ยังไม่ได้ผูกกับข้อมูลพนักงาน กรุณาติดต่อแอดมินคลัง</Alert>
        <Button className="mt-4 w-full" variant="secondary" onClick={signOut}>ออกจากระบบ</Button>
      </Centered>
    );
  if (data.profile.status !== "active")
    return (
      <Centered>
        <Alert tone="warning">บัญชีนี้ถูกปิดใช้งานแล้ว กรุณาติดต่อแอดมินคลัง</Alert>
        <Button className="mt-4 w-full" variant="secondary" onClick={signOut}>ออกจากระบบ</Button>
      </Centered>
    );
  if (mustChange && pathname !== CHANGE_PASSWORD) return <Loading />;

  return (
    <Ctx.Provider
      value={{
        session,
        profile: data.profile,
        warehouses: data.warehouses,
        myWarehouseIds: data.myWarehouseIds,
        preview: false,
        demo: null,
        reload: () => load(session.user.id),
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto mt-20 max-w-md px-4">{children}</div>;
}

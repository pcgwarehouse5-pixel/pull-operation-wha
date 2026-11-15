"use client";

// ประชาสัมพันธ์ (หัวหน้างานขึ้นไป): เพิ่ม/แก้/ลบ ภาพประกาศที่เด้งเมื่อเปิดแอป ตั้งช่วงวันที่ และลิงก์เมื่อแตะภาพ
// ทุกคนทุกคลังเห็น · ภาพย่อในเครื่องก่อนอัปโหลด · ลบแบบเก็บประวัติ
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/components/AuthProvider";
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, inputCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { PageHelper } from "@/components/Puinun";
import { AnnouncementModal } from "@/components/announcements/AnnouncementPopup";
import { loadAll } from "@/components/announcements/data";
import { useI18n } from "@/i18n";
import { errText, sb } from "@/lib/supabase";
import { addDays, todayIso } from "@/lib/shifts";
import { NAV_GROUPS } from "@/lib/nav";
import { compressImage } from "@/lib/image-compress";
import { ANN_BUCKET, groupAnnouncements, urlHost, validMenuPath, validUrl, type AnnouncementView, type LinkType } from "@/lib/announcements";

type Form = {
  id?: string;
  title: string;
  starts: string;
  ends: string;
  linkType: LinkType;
  url: string;
  menu: string;
  imagePath: string | null; // ภาพเดิม (ตอนแก้)
  file: File | null; // ภาพใหม่ที่เลือก
  preview: string | null;
};

// เมนูในแอปที่เลือกเป็นปลายทางได้ (ทุกเมนู · ถ้าคนเปิดไม่มีสิทธิ์ หน้านั้นจะบอกเอง)
const MENU_OPTIONS = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ href: i.href, label: `${g.title} · ${i.label}` })));
const menuLabel = (href: string | null) => MENU_OPTIONS.find((m) => m.href === href)?.label.split(" · ").pop() ?? href ?? "";

export default function AnnouncementsPage() {
  const { demo } = useApp();
  const { fmt } = useI18n();
  const today = todayIso();
  const [rows, setRows] = useState<AnnouncementView[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [preview, setPreview] = useState<AnnouncementView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [formErr, setFormErr] = useState("");

  const load = useCallback(async () => {
    if (demo) return setRows((r) => r ?? demo.previewAnnouncements(todayIso()));
    try {
      setRows(await loadAll());
    } catch (e) {
      setRows([]);
      setMsg({ tone: "error", text: errText(e) });
    }
  }, [demo]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => groupAnnouncements(rows ?? [], today), [rows, today]);
  const range = (a: AnnouncementView) => (a.starts_on === a.ends_on ? fmt.day(a.starts_on) : `${fmt.day(a.starts_on)} – ${fmt.day(a.ends_on)}`);

  const openNew = () => {
    setFormErr("");
    setForm({ title: "", starts: today, ends: addDays(today, 7), linkType: "none", url: "", menu: "", imagePath: null, file: null, preview: null });
  };
  const openEdit = (a: AnnouncementView) => {
    setFormErr("");
    setForm({
      id: a.id, title: a.title, starts: a.starts_on, ends: a.ends_on, linkType: a.link_type,
      url: a.link_url ?? "", menu: a.link_menu ?? "", imagePath: a.image_path, file: null, preview: a.image_url,
    });
  };

  function pickFile(f: File | undefined) {
    if (!form || !f) return;
    if (!f.type.startsWith("image/")) return setFormErr("เลือกได้เฉพาะไฟล์ภาพ (JPG, PNG, WebP)");
    if (f.size > 15 * 1024 * 1024) return setFormErr("ภาพใหญ่เกิน 15 MB");
    setFormErr("");
    setForm({ ...form, file: f, preview: URL.createObjectURL(f) });
  }

  async function save() {
    if (!form) return;
    const title = form.title.trim();
    if (!title) return setFormErr("กรุณาใส่หัวข้อประกาศ");
    if (!form.file && !form.imagePath) return setFormErr("กรุณาแนบภาพประกาศ");
    if (!form.starts || !form.ends || form.ends < form.starts) return setFormErr("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
    if (addDays(form.starts, 366) < form.ends) return setFormErr("แสดงได้ไม่เกิน 1 ปีต่อประกาศ");
    const url = form.linkType === "url" ? validUrl(form.url) : null;
    if (form.linkType === "url" && !url) return setFormErr("ลิงก์เว็บต้องขึ้นต้นด้วย https://");
    if (form.linkType === "menu" && !validMenuPath(form.menu)) return setFormErr("กรุณาเลือกเมนูที่จะไป");
    setBusy(true);
    setFormErr("");
    let uploaded: string | null = null;
    try {
      let imagePath = form.imagePath;
      if (demo) {
        const row: AnnouncementView = {
          id: form.id ?? `demo-${Date.now()}`, title, image_path: imagePath ?? "00000000-0000-0000-0000-000000000000.webp",
          image_url: form.preview, link_type: form.linkType, link_url: url, link_menu: form.linkType === "menu" ? form.menu : null,
          starts_on: form.starts, ends_on: form.ends,
        };
        setRows((r) => [row, ...(r ?? []).filter((x) => x.id !== row.id)]);
      } else {
        if (form.file) {
          const c = await compressImage(form.file);
          if (c.blob.size > 3 * 1024 * 1024) throw new Error("ภาพหลังย่อยังใหญ่เกิน 3 MB ลองใช้ภาพที่เล็กลง");
          uploaded = `${crypto.randomUUID()}.${c.ext}`;
          const up = await sb().storage.from(ANN_BUCKET).upload(uploaded, c.blob, { contentType: c.ext === "webp" ? "image/webp" : "image/jpeg", upsert: false });
          if (up.error) throw up.error;
          imagePath = uploaded;
        }
        const { error } = await sb().rpc("save_announcement", {
          p_id: form.id ?? null, p_title: title, p_image_path: imagePath, p_link_type: form.linkType,
          p_link_url: url, p_link_menu: form.linkType === "menu" ? form.menu : null, p_starts: form.starts, p_ends: form.ends,
        });
        if (error) throw error;
        uploaded = null;
        await load();
      }
      setMsg({ tone: "success", text: `${form.id ? "แก้ไข" : "เพิ่ม"}ประกาศ "${title}" แล้ว${demo ? " · โหมดตัวอย่าง" : ""}` });
      setForm(null);
    } catch (e) {
      if (uploaded) await sb().storage.from(ANN_BUCKET).remove([uploaded]).catch(() => null); // ไม่ทิ้งภาพที่บันทึกไม่สำเร็จ
      setFormErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: AnnouncementView) {
    if (!confirm(`ลบประกาศ "${a.title}" ?\nพนักงานจะไม่เห็นป๊อปอัปนี้อีก (ระบบเก็บประวัติการลบไว้)`)) return;
    try {
      if (demo) setRows((r) => (r ?? []).filter((x) => x.id !== a.id));
      else {
        const { error } = await sb().rpc("delete_announcement", { p_id: a.id });
        if (error) throw error;
        await load();
      }
      setMsg({ tone: "success", text: `ลบประกาศ "${a.title}" แล้ว` });
    } catch (e) {
      setMsg({ tone: "error", text: errText(e) });
    }
  }

  const section = (title: string, list: AnnouncementView[], tone: "green" | "blue" | "slate", note?: string) =>
    list.length > 0 && (
      <section className="mb-5">
        <h2 className="mb-2 flex items-center gap-2 px-1 text-[16px] font-bold text-ink">
          {title} <Badge tone={tone}>{list.length}</Badge>
        </h2>
        {note && <p className="mb-2 px-1 text-[13px] text-muted">{note}</p>}
        <ul className="space-y-2.5">
          {list.map((a) => (
            <li key={a.id}>
              <Card className="!p-3">
                <div className="flex gap-3">
                  <button type="button" onClick={() => setPreview(a)} className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-paper ring-1 ring-line" aria-label={`ดูตัวอย่าง ${a.title}`}>
                    {a.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- ภาพจากที่เก็บแบบปิด (ลิงก์ชั่วคราว)
                      <img src={a.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon name="alert" className="m-auto text-muted" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 leading-snug font-bold text-ink">{a.title}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[14px] text-ink">
                      <Icon name="calendar" size={16} className="text-muted" /> {range(a)}
                    </p>
                    <p className="flex items-center gap-1 truncate text-[13px] text-muted">
                      <Icon name={a.link_type === "url" ? "link" : a.link_type === "menu" ? "next" : "close"} size={15} />
                      {a.link_type === "url" ? `เปิดเว็บ ${urlHost(a.link_url)}` : a.link_type === "menu" ? `ไปเมนู ${menuLabel(a.link_menu)}` : "ไม่มีลิงก์"}
                    </p>
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPreview(a)}>
                    <Icon name="search" size={18} /> ดูตัวอย่าง
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(a)}>แก้ไข</Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-bad" onClick={() => remove(a)}>
                    <Icon name="trash" size={18} /> ลบ
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <AppShell title="ประชาสัมพันธ์" minRole="supervisor">
      <PageHelper
        pose="point"
        title="ประชาสัมพันธ์"
        action={
          <Button onClick={openNew}>
            <Icon name="plus" size={20} /> เพิ่มประกาศ
          </Button>
        }
      >
        ภาพประกาศจะเด้งให้พนักงานทุกคนทุกคลังเห็นทุกครั้งที่เปิดแอป ตามช่วงวันที่ที่ตั้งไว้ แตะภาพเพื่อไปลิงก์หรือเมนูที่กำหนด
      </PageHelper>
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty pose="docs">ยังไม่มีประกาศ กดปุ่ม “เพิ่มประกาศ” เพื่อเริ่ม</Empty>
      ) : (
        <>
          {section("กำลังแสดง", groups.now, "green", "พนักงานเห็นป๊อปอัปเหล่านี้เมื่อเปิดแอปวันนี้")}
          {section("รอแสดง", groups.upcoming, "blue")}
          {section("หมดเวลาแล้ว", groups.ended.slice(0, 20), "slate", "ไม่เด้งแล้ว เก็บไว้ดูย้อนหลังหรือแก้วันที่เพื่อแสดงอีกครั้ง")}
        </>
      )}

      {form && (
        <Modal title={form.id ? "แก้ไขประกาศ" : "เพิ่มประกาศ"} onClose={() => !busy && setForm(null)}>
          <div className="space-y-4">
            <Field label="ภาพประกาศ (จำเป็น)" hint="แนะนำภาพแนวตั้งหรือสี่เหลี่ยม ระบบย่อภาพให้เองก่อนอัปโหลด">
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line bg-paper p-3 text-center hover:border-brand/50">
                {form.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- ตัวอย่างภาพที่เลือกในเครื่อง
                  <img src={form.preview} alt="ตัวอย่างภาพประกาศ" className="max-h-64 w-auto rounded-xl object-contain" />
                ) : (
                  <Icon name="plus" size={36} className="text-muted" />
                )}
                <span className="font-semibold text-brand">{form.preview ? "เปลี่ยนภาพ" : "เลือกภาพ"}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
              </label>
            </Field>
            <Field label="หัวข้อ (แสดงใต้ภาพ)">
              <input className={inputCls} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="เช่น กิจกรรมทำความสะอาดคลัง วันเสาร์นี้" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="แสดงตั้งแต่">
                <input type="date" className={inputCls} value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} />
              </Field>
              <Field label="ถึงวันที่">
                <input type="date" className={inputCls} value={form.ends} min={form.starts} onChange={(e) => setForm({ ...form, ends: e.target.value })} />
              </Field>
            </div>
            <Field label="เมื่อแตะภาพ">
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="เมื่อแตะภาพ">
                {([["none", "ไม่ต้องไปไหน"], ["url", "เปิดลิงก์เว็บ"], ["menu", "ไปเมนูในแอป"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={form.linkType === v}
                    onClick={() => setForm({ ...form, linkType: v })}
                    className={`min-h-12 rounded-xl px-2 text-[14px] font-semibold ring-1 ${form.linkType === v ? "bg-sky text-brand ring-2 ring-brand" : "bg-white text-ink ring-line"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            {form.linkType === "url" && (
              <Field label="ลิงก์เว็บ" hint="ต้องขึ้นต้นด้วย https:// เปิดในแท็บใหม่">
                <input type="url" inputMode="url" className={inputCls} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" />
              </Field>
            )}
            {form.linkType === "menu" && (
              <Field label="เมนูที่จะไป">
                <select className={inputCls} value={form.menu} onChange={(e) => setForm({ ...form, menu: e.target.value })}>
                  <option value="">— เลือกเมนู —</option>
                  {MENU_OPTIONS.map((m) => (
                    <option key={m.href} value={m.href}>{m.label}</option>
                  ))}
                </select>
              </Field>
            )}
            {formErr && <Alert tone="error">{formErr}</Alert>}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setForm(null)}>ยกเลิก</Button>
              <Button className="flex-1" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
            </div>
          </div>
        </Modal>
      )}

      {preview && <AnnouncementModal list={[preview]} onClose={() => setPreview(null)} />}
    </AppShell>
  );
}

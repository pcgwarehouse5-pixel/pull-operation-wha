"use client";

// วันหยุดประจำปี (เมนู จัดการ → วันหยุดประจำปี และหน้าตั้งค่าตัวเลือก → วันหยุด)
// แสดงในตารางกะเป็นสีม่วง · ใครมีกะทำงานวันนั้นคิด OT วันหยุดให้อัตโนมัติ · แก้ได้เฉพาะแอดมินคลังขึ้นไป
import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AuthProvider";
import { Alert, Button, Card, Empty, Field, Loading, Modal, inputCls } from "./ui";
import { Icon } from "./Icon";
import { errText, sb } from "@/lib/supabase";
import { thaiDate } from "@/lib/format";
import { THAI_DAYS_SHORT, weekday } from "@/lib/shifts";
import { ROLE_RANK } from "@/lib/types";

type Holiday = { id: string; holiday_date: string; name: string };
type Form = { id?: string; holiday_date: string; name: string };

export function HolidaysManager() {
  const { demo, profile } = useApp();
  const canEdit = ROLE_RANK[profile.role] >= ROLE_RANK.admin; // วันหยุดมีผลกับ OT ทุกคลัง
  const [minDays, setMinDays] = useState<number | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [rows, setRows] = useState<Holiday[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    if (demo) return setRows(demo.PREVIEW_HOLIDAYS.filter((h) => h.holiday_date.startsWith(String(year))));
    const { data, error } = await sb().from("holidays").select("id, holiday_date, name").gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`).order("holiday_date");
    if (error) setErr(errText(error));
    setRows((data ?? []) as Holiday[]);
  }, [demo, year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจาก Supabase ตอนเปลี่ยนปี
    load();
  }, [load]);

  // จำนวนวันหยุดตามประเพณีขั้นต่ำ (ตั้งค่าได้ · ค่าเริ่มต้นตาม พ.ร.บ.คุ้มครองแรงงาน มาตรา 29)
  useEffect(() => {
    if (demo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- โหมดดูดีไซน์
      setMinDays(13);
      return;
    }
    sb()
      .rpc("setting", { p_key: "holidays.min_per_year", p_date: `${year}-12-31` })
      .then(({ data }) => setMinDays(typeof data === "number" ? data : Number(data) || null));
  }, [demo, year]);

  // คัดลอกรายการวันหยุดจากปีก่อน (วันที่เดิม +1 ปี) แล้วให้ตรวจแก้วันที่ตามประกาศจริง
  async function copyLastYear() {
    if (demo) return;
    const { data, error } = await sb().from("holidays").select("holiday_date, name").gte("holiday_date", `${year - 1}-01-01`).lte("holiday_date", `${year - 1}-12-31`);
    if (error) return setErr(errText(error));
    const list = ((data ?? []) as { holiday_date: string; name: string }[])
      .map((h) => ({ holiday_date: `${year}${h.holiday_date.slice(4)}`, name: h.name }))
      .filter((h) => !Number.isNaN(Date.parse(h.holiday_date)) && !(rows ?? []).some((r) => r.holiday_date === h.holiday_date));
    if (!list.length) return setErr(`ปี ${year + 542} ไม่มีวันหยุดให้คัดลอก (หรือมีครบแล้ว)`);
    if (!confirm(`คัดลอก ${list.length} วันจากปี ${year + 542} มาเป็นปี ${year + 543}?
วันหยุดตามจันทรคติ (เช่น มาฆบูชา วิสาขบูชา อาสาฬหบูชา) วันที่จะเปลี่ยนทุกปี ต้องแก้ให้ตรงประกาศของบริษัท`)) return;
    const { error: e2 } = await sb().from("holidays").insert(list);
    if (e2) return setErr(errText(e2));
    load();
  }

  async function save() {
    if (!form) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.holiday_date) || !form.name.trim()) return setErr("กรุณาเลือกวันที่และใส่ชื่อวันหยุด");
    if (demo) return setForm(null);
    setBusy(true);
    setErr("");
    const body = { holiday_date: form.holiday_date, name: form.name.trim() };
    const { error } = form.id ? await sb().from("holidays").update(body).eq("id", form.id) : await sb().from("holidays").insert(body);
    setBusy(false);
    if (error) return setErr(errText(error));
    setForm(null);
    load();
  }

  async function remove(h: Holiday) {
    if (!confirm(`ลบวันหยุด "${h.name}" ?\n(กะที่ใส่ HOL ไว้แล้วในตารางกะจะไม่ถูกลบ)`)) return;
    if (demo) return;
    const { error } = await sb().from("holidays").delete().eq("id", h.id);
    if (error) return setErr(errText(error));
    load();
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setYear(year - 1)} aria-label="ปีก่อน">
          <Icon name="back" size={18} />
        </Button>
        <span className="min-w-24 text-center text-lg font-bold text-brand">ปี {year + 543}</span>
        <Button variant="secondary" size="sm" onClick={() => setYear(year + 1)} aria-label="ปีถัดไป">
          <Icon name="next" size={18} />
        </Button>
        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={copyLastYear}>
              <Icon name="history" size={18} /> คัดลอกจากปี {year + 542}
            </Button>
            <Button size="sm" onClick={() => setForm({ holiday_date: `${year}-01-01`, name: "" })}>
              <Icon name="plus" size={18} /> เพิ่มวันหยุด
            </Button>
          </div>
        )}
      </div>
      {rows && minDays !== null && (
        <div className="mb-3">
          <Alert tone={rows.length >= minDays ? "success" : "warning"}>
            ปี {year + 543} มีวันหยุด {rows.length} วัน
            {rows.length >= minDays ? ` · ครบขั้นต่ำ ${minDays} วันแล้ว` : ` · ยังไม่ถึงขั้นต่ำ ${minDays} วัน (ตามที่ตั้งค่าไว้)`}
          </Alert>
        </div>
      )}
      <p className="mb-3 text-[14px] text-muted">
        วันหยุดในหน้านี้ขึ้นเป็น<b className="text-[#7c3aed]">สีม่วง</b>ในตารางกะ · ใครมีกะทำงานวันนั้น ระบบคิด OT วันหยุดให้อัตโนมัติ
        · ใส่ตามประกาศวันหยุดของบริษัททุกปี (พ.ร.บ.คุ้มครองแรงงาน มาตรา 29: ไม่น้อยกว่าปีละ 13 วัน รวมวันแรงงานแห่งชาติ
        ถ้าตรงวันหยุดประจำสัปดาห์ให้หยุดชดเชยวันทำงานถัดไป) ตรวจกับกรมสวัสดิการและคุ้มครองแรงงาน
        {!canEdit && " · แก้ได้เฉพาะแอดมินคลังขึ้นไป"}
      </p>
      {err && <div className="mb-3"><Alert tone="error">{err}</Alert></div>}
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>ยังไม่มีวันหยุดของปีนี้</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((h) => (
            <li key={h.id}>
              <Card className="!p-3.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[#ede4fe] text-[#7c3aed]">
                    <span className="text-[17px] font-bold leading-none">{Number(h.holiday_date.slice(8))}</span>
                    <span className="text-[12px]">{THAI_DAYS_SHORT[weekday(h.holiday_date)]}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{h.name}</p>
                    <p className="text-[14px] text-muted">{thaiDate(`${h.holiday_date}T12:00:00+07:00`)}</p>
                  </div>
                  {canEdit && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setForm(h)}>แก้ไข</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(h)} aria-label={`ลบ ${h.name}`}>
                        <Icon name="close" size={18} />
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {form && (
        <Modal title={form.id ? "แก้ไขวันหยุด" : "เพิ่มวันหยุด"} onClose={() => setForm(null)}>
          <div className="space-y-4">
            <Field label="วันที่">
              <input type="date" className={inputCls} value={form.holiday_date} onChange={(e) => setForm({ ...form, holiday_date: e.target.value })} />
            </Field>
            <Field label="ชื่อวันหยุด">
              <input className={inputCls} maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น วันขึ้นปีใหม่" />
            </Field>
            {err && <Alert tone="error">{err}</Alert>}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setForm(null)}>ยกเลิก</Button>
              <Button className="flex-1" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก..." : "บันทึก"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

"use client";

// ปฏิทินวันหยุดนักขัตฤกษ์ (หน้าตั้งค่าตัวเลือก → วันหยุด) ใช้เติม "HOL" ในตารางกะ และคิดค่าทำงานวันหยุดในโมดูล OT
import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AuthProvider";
import { Alert, Button, Card, Empty, Field, Loading, Modal, inputCls } from "./ui";
import { Icon } from "./Icon";
import { errText, sb } from "@/lib/supabase";
import { thaiDate } from "@/lib/format";
import { THAI_DAYS_SHORT, weekday } from "@/lib/shifts";

type Holiday = { id: string; holiday_date: string; name: string };
type Form = { id?: string; holiday_date: string; name: string };

export function HolidaysManager() {
  const { demo } = useApp();
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
        <Button size="sm" className="ml-auto" onClick={() => setForm({ holiday_date: `${year}-01-01`, name: "" })}>
          <Icon name="plus" size={18} /> เพิ่มวันหยุด
        </Button>
      </div>
      <p className="mb-3 text-[14px] text-muted">ตรวจรายการวันหยุดตามประกาศของบริษัททุกปี (ต้องมีวันหยุดตามประเพณีไม่น้อยกว่าที่กฎหมายกำหนด ตรวจกับกรมสวัสดิการและคุ้มครองแรงงาน)</p>
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
                  <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[#fce6e7] text-bad">
                    <span className="text-[17px] font-bold leading-none">{Number(h.holiday_date.slice(8))}</span>
                    <span className="text-[12px]">{THAI_DAYS_SHORT[weekday(h.holiday_date)]}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{h.name}</p>
                    <p className="text-[14px] text-muted">{thaiDate(`${h.holiday_date}T12:00:00+07:00`)}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setForm(h)}>แก้ไข</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(h)} aria-label={`ลบ ${h.name}`}>
                    <Icon name="close" size={18} />
                  </Button>
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

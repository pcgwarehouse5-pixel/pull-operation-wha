"use client";

// ขอแก้เวลา (ลืมกด / GPS ใช้ไม่ได้) — หัวหน้างานยื่นแทนพนักงานได้ (ส่ง userId)
import { useState } from "react";
import { useApp } from "../AuthProvider";
import { Alert, Button, Field, Modal, inputCls } from "../ui";
import { sb } from "@/lib/supabase";
import { localizeError, useI18n } from "@/i18n";
import { todayIso } from "@/lib/shifts";

export function CorrectionModal({
  date, userId, who, onClose, onDone,
}: {
  date: string;
  userId?: string;
  who?: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { demo } = useApp();
  const { t } = useI18n();
  const [d, setD] = useState(date);
  const [tin, setTin] = useState("");
  const [tout, setTout] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    setErr("");
    if (!tin && !tout) return setErr(t("fix.needTime"));
    if (!reason.trim()) return setErr(t("fix.needReason"));
    if (demo) return onDone(t("common.demoNotSaved"));
    setBusy(true);
    const { error } = await sb().rpc("request_correction", { p_date: d, p_in: tin || null, p_out: tout || null, p_reason: reason.trim(), p_user: userId ?? null });
    setBusy(false);
    if (error) return setErr(localizeError(error.message, t));
    onDone(t("fix.sent"));
  }

  return (
    <Modal title={who ? t("fix.titleFor", { name: who }) : t("fix.title")} onClose={onClose}>
      <p className="-mt-2 mb-3 text-[15px] text-muted">{t("fix.intro")}</p>
      <div className="space-y-3">
        <Field label={t("fix.date")}>
          <input type="date" className={inputCls} value={d} max={todayIso()} onChange={(e) => setD(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("fix.in")}>
            <input type="time" className={inputCls} value={tin} onChange={(e) => setTin(e.target.value)} />
          </Field>
          <Field label={t("fix.out")} hint={t("fix.outHint")}>
            <input type="time" className={inputCls} value={tout} onChange={(e) => setTout(e.target.value)} />
          </Field>
        </div>
        <Field label={t("fix.reason")}>
          <textarea className={`${inputCls} min-h-20 py-2`} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("fix.reasonPh")} />
        </Field>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>{t("common.cancel")}</Button>
        <Button className="flex-1" onClick={send} disabled={busy}>{busy ? t("fix.sending") : t("fix.send")}</Button>
      </div>
    </Modal>
  );
}

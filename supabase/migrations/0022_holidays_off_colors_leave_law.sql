-- =====================================================================
-- 0022 วันหยุดประจำปี + OFF 2 สี + ปรับวันลาตามกฎหมายใหม่
--   OT: กะทำงานที่ตรงกับวันหยุดประจำปี คิดเป็นทำงานวันหยุดอัตโนมัติ
--       OFF แดง (รหัส OFF) = วันหยุดประจำสัปดาห์ → มาทำงานได้ OT (ตารางกะติดธงให้เองตอนเปลี่ยนเป็นกะทำงาน)
--       OFF เหลือง (รหัส OFFC, no_ot) = วันหยุดที่บริษัทให้พิเศษ → เปลี่ยนเป็นวันทำงานไม่ได้ OT
--   ลา: พ.ร.บ.คุ้มครองแรงงาน (ฉบับที่ 9) พ.ศ. 2568 มีผล 7 ธ.ค. 2568
--       ลาคลอด 120 วัน (มาตรา 41) · ลาช่วยภรรยาคลอด 15 วัน (มาตรา 41/1)
--       ลาดูแลบุตรต่อจากลาคลอด 15 วัน ต้องมีใบรับรองแพทย์ (มาตรา 41 วรรคสี่)
--       "ขาดงาน" ไม่ใช่ประเภทลา (ระบบคำนวณจากการลงเวลาเอง) → ปิดใช้
--   วันหยุดประจำปี แก้ได้เฉพาะแอดมินคลังขึ้นไป (มีผลกับ OT ทุกคลัง)
-- =====================================================================

-- ---------- รหัสกะ: OFF แดง / OFF เหลือง / วันนักขัตฤกษ์สีม่วง ----------
update public.dropdown_options set label = 'OFF', extra = extra || '{"bg": "#ff0000", "text": "#fff"}'::jsonb
where category = 'shift_type' and value = 'OFF' and label = 'หยุด';
update public.dropdown_options set extra = extra || '{"bg": "#7c3aed", "text": "#fff"}'::jsonb
where category = 'shift_type' and value = 'HOL' and extra ->> 'bg' = '#ff0000';
update public.dropdown_options set sort_order = sort_order + 1
where category = 'shift_type' and sort_order > (select sort_order from public.dropdown_options where category = 'shift_type' and value = 'OFF')
  and not exists (select 1 from public.dropdown_options where category = 'shift_type' and value = 'OFFC');
insert into public.dropdown_options (category, value, label, sort_order, extra)
select 'shift_type', 'OFFC', 'OFF', coalesce((select sort_order from public.dropdown_options where category = 'shift_type' and value = 'OFF'), 0) + 1,
       '{"bg": "#facc15", "text": "#16204a", "no_ot": true}'::jsonb
on conflict (category, value) do nothing;

-- ---------- ประเภทลา ----------
update public.dropdown_options set is_active = false where category = 'leave_type' and value = 'absent';
insert into public.dropdown_options (category, value, label, sort_order) values
  ('leave_type', 'paternity', 'ช่วยภรรยาคลอดบุตร', 20),
  ('leave_type', 'child_care', 'ดูแลบุตรต่อจากลาคลอด', 21)
on conflict (category, value) do nothing;

-- โควตา (ตั้งค่าได้ที่ ตั้งค่า → กฎและอัตรา) เริ่มใช้ 7 ธ.ค. 2568 · ค่าอื่นคงตามเดิม
insert into public.app_settings (key, effective_from, value, note)
select 'leave.quota', '2025-12-07',
       coalesce((select value from public.app_settings where key = 'leave.quota' and effective_from <= '2025-12-07' order by effective_from desc limit 1), '{}'::jsonb)
       || '{"maternity": 120, "paternity": 15, "child_care": 15}'::jsonb,
       'พ.ร.บ.คุ้มครองแรงงาน (ฉบับที่ 9) พ.ศ. 2568: ลาคลอด 120 วัน, ลาช่วยภรรยาคลอด 15 วัน, ลาดูแลบุตรต่อจากลาคลอด 15 วัน'
on conflict do nothing;
insert into public.app_settings (key, effective_from, value, note)
select 'leave.attachment_types', '2025-12-07',
       (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(
          coalesce((select value from public.app_settings where key = 'leave.attachment_types' and effective_from <= '2025-12-07' order by effective_from desc limit 1), '[]'::jsonb)
          || '["child_care"]'::jsonb) x),
       'ลาดูแลบุตรต่อจากลาคลอด ต้องมีใบรับรองแพทย์ (มาตรา 41 วรรคสี่)'
on conflict do nothing;

-- จำนวนวันหยุดตามประเพณีขั้นต่ำต่อปี (พ.ร.บ.คุ้มครองแรงงาน มาตรา 29) ใช้เตือนในหน้าวันหยุดประจำปี
insert into public.app_settings (key, effective_from, value, note) values
  ('holidays.min_per_year', '2000-01-01', '13', 'วันหยุดตามประเพณีไม่น้อยกว่าปีละ 13 วัน รวมวันแรงงานแห่งชาติ (มาตรา 29) ตรวจกับกรมสวัสดิการและคุ้มครองแรงงาน')
on conflict do nothing;

-- ---------- วันหยุดประจำปี: แอดมินคลังขึ้นไปแก้ได้ ----------
drop policy holidays_write on public.holidays;
create policy holidays_write on public.holidays for all to authenticated
  using (coalesce(public.role_rank((select public.my_role())), 0) >= 3)
  with check (coalesce(public.role_rank((select public.my_role())), 0) >= 3);

-- ---------- OT: ตัดสินประเภทวันใหม่ (คัดลอกจากนิยามปัจจุบัน แก้เฉพาะ v_day) ----------
CREATE OR REPLACE FUNCTION public.ot_rows_core(p_users uuid[], p_from date, p_to date, p_now timestamp with time zone)
 RETURNS TABLE(user_id uuid, work_date date, day_type text, shift_code text, first_in timestamp with time zone, last_out timestamp with time zone, normal_hours numeric, normal_rate numeric, ot_hours numeric, ot_rate numeric, approval text, decided_by_name text, decided_at timestamp with time zone, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_hw text;
  v_vol boolean;
  v_type text;
  v_elig boolean;
  v_day text;
  v_min numeric; v_step numeric; v_cap numeric; v_brk numeric; v_brk_after numeric; v_hol_h numeric;
  v_worked numeric; v_cap_min numeric; v_norm_min numeric;
  v_nh numeric; v_oh numeric; v_nr numeric; v_or numeric;
  a public.ot_approvals%rowtype;
begin
  for r in select * from public.attendance_rows_core(p_users, p_from, p_to, p_now) x
           where x.first_in is not null and x.last_out is not null and x.last_out > x.first_in
  loop
    select s.holiday_work, s.is_volunteer into v_hw, v_vol
    from public.shift_schedules s where s.user_id = r.user_id and s.work_date = r.work_date;
    select p.employment_type, p.ot_eligible into v_type, v_elig from public.profiles p where p.id = r.user_id;
    if not coalesce(v_elig, true) or coalesce(v_vol, false) then
      continue;
    end if;
    v_day := case
      when v_hw is not null then v_hw
      -- ใหม่: กะทำงานตรงกับวันหยุดประจำปี = ทำงานวันหยุด (OT อัตโนมัติ ไม่ต้องติ๊ก "นักขัตฤกษ์")
      when r.shift_start is not null and exists (select 1 from public.holidays h where h.holiday_date = r.work_date) then 'HOL'
      when r.shift_code is not null and r.shift_start is null then
        case
          -- ใหม่: วันหยุดที่บริษัทให้พิเศษ (รหัสที่ตั้ง no_ot เช่น OFF เหลือง) มาทำงาน = ไม่คิด OT
          when exists (select 1 from public.dropdown_options o where o.category = 'shift_type' and o.value = r.shift_code
                       and coalesce((o.extra ->> 'no_ot')::boolean, false)) then null
          when r.shift_code = 'HOL' or exists (select 1 from public.holidays h where h.holiday_date = r.work_date) then 'HOL'
          else 'OFF'
        end
      when r.shift_start is not null then 'normal'
      else null
    end;
    continue when v_day is null;

    v_min := public.setting_num('ot.min_minutes', r.work_date, 60);
    v_step := public.setting_num('ot.round_minutes', r.work_date, 30);
    v_cap := public.setting_num('ot.max_hours_per_day', r.work_date, 16);
    v_nh := 0; v_oh := 0; v_nr := null; v_or := null;

    if v_day = 'normal' then
      v_oh := public.ot_round(extract(epoch from r.last_out - r.shift_end) / 60, v_min, v_step, v_cap);
      v_or := public.ot_rate(v_type, r.work_date, 'workday');
    else
      v_brk := public.setting_num('ot.break_minutes', r.work_date, 60);
      v_brk_after := public.setting_num('ot.break_after_minutes', r.work_date, 480);
      v_hol_h := public.setting_num('ot.holiday_normal_hours', r.work_date, 8);
      v_worked := extract(epoch from r.last_out - greatest(r.first_in, coalesce(r.shift_start, r.first_in))) / 60;
      if v_worked >= v_brk_after then
        v_worked := v_worked - v_brk;
      end if;
      v_cap_min := case
        when r.shift_start is not null then extract(epoch from r.shift_end - r.shift_start) / 60
             - case when extract(epoch from r.shift_end - r.shift_start) / 60 >= v_brk_after then v_brk else 0 end
        else v_hol_h * 60
      end;
      v_norm_min := greatest(0, least(v_worked, v_cap_min));
      v_nh := least(floor(v_norm_min / greatest(v_step, 1)) * greatest(v_step, 1) / 60.0, v_cap);
      v_oh := public.ot_round(v_worked - v_norm_min, v_min, v_step, v_cap);
      v_nr := public.ot_rate(v_type, r.work_date, 'holiday_normal');
      v_or := public.ot_rate(v_type, r.work_date, 'holiday_ot');
    end if;
    continue when v_nh <= 0 and v_oh <= 0;

    select * into a from public.ot_approvals oa where oa.user_id = r.user_id and oa.work_date = r.work_date;
    user_id := r.user_id; work_date := r.work_date; day_type := v_day; shift_code := r.shift_code;
    first_in := r.first_in; last_out := r.last_out;
    normal_hours := v_nh; normal_rate := case when v_nh > 0 then v_nr end;
    ot_hours := v_oh; ot_rate := case when v_oh > 0 then v_or end;
    approval := case
      when a.user_id is null then 'pending'
      when a.normal_hours = v_nh and a.ot_hours = v_oh
           and a.normal_rate is not distinct from (case when v_nh > 0 then v_nr end)
           and a.ot_rate is not distinct from (case when v_oh > 0 then v_or end) then a.status
      else 'changed'
    end;
    decided_by_name := a.decided_by_name; decided_at := a.decided_at; note := a.note;
    return next;
  end loop;
end $function$;

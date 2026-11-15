-- =====================================================================
-- 0024 ประชาสัมพันธ์ (ป๊อปอัปเมื่อเปิดแอป)
--   ทุกคนทุกคลังเห็นประกาศที่อยู่ในช่วงวันที่ · เด้งทุกครั้งที่เปิดแอป · มีปุ่มปิด
--   แตะภาพ → เปิดลิงก์เว็บ (https เท่านั้น) หรือ ไปหน้าเมนูในแอป หรือ ไม่มีลิงก์
--   หัวหน้างาน/แอดมินคลังขึ้นไป เพิ่ม/แก้/ลบ (ลบแบบเก็บประวัติ) · ภาพเก็บในที่เก็บแบบปิด (เฉพาะคนที่ล็อกอิน)
-- =====================================================================

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  image_path text not null check (image_path ~ '^[0-9a-f-]{36}\.(webp|jpg|png)$'),
  link_type text not null default 'none' check (link_type in ('none', 'url', 'menu')),
  link_url text check (link_url is null or (link_url ~ '^https://[^\s]+$' and char_length(link_url) <= 500)),
  link_menu text check (link_menu is null or link_menu ~ '^/[a-z0-9/_-]*$'),
  starts_on date not null,
  ends_on date not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid,
  check (ends_on >= starts_on),
  check ((link_type = 'url' and link_url is not null) or (link_type = 'menu' and link_menu is not null) or link_type = 'none')
);
create index announcements_active_idx on public.announcements (starts_on, ends_on) where deleted_at is null;

create trigger announcements_audit after insert or update or delete on public.announcements
  for each row execute function public.audit_row();

alter table public.announcements enable row level security;
revoke all on public.announcements from anon;
revoke insert, update, delete on public.announcements from authenticated;
-- ทุกคนเห็นประกาศที่ถึงวันแสดง · หัวหน้างานขึ้นไปเห็นทั้งหมด (รวมที่ยังไม่ถึงวัน/หมดเวลาแล้ว) เพื่อจัดการ
create policy announcements_read on public.announcements for select to authenticated using (
  deleted_at is null and (
    (now() at time zone 'Asia/Bangkok')::date between starts_on and ends_on
    or coalesce(public.role_rank((select public.my_role())), 0) >= 2
  )
);

-- เพิ่ม (p_id = null) / แก้ประกาศ
create function public.save_announcement(
  p_id uuid, p_title text, p_image_path text, p_link_type text, p_link_url text, p_link_menu text, p_starts date, p_ends date
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(public.role_rank(public.my_role()), 0) < 2 then
    raise exception 'ไม่มีสิทธิ์จัดการประชาสัมพันธ์';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'กรุณาใส่หัวข้อประกาศ';
  end if;
  if coalesce(p_image_path, '') = '' then
    raise exception 'กรุณาแนบภาพประกาศ';
  end if;
  if p_starts is null or p_ends is null or p_ends < p_starts then
    raise exception 'กรุณาเลือกช่วงวันที่ให้ถูกต้อง (วันสิ้นสุดต้องไม่ก่อนวันเริ่ม)';
  end if;
  if p_ends - p_starts > 366 then
    raise exception 'แสดงได้ไม่เกิน 1 ปีต่อประกาศ';
  end if;
  if p_link_type not in ('none', 'url', 'menu') then
    raise exception 'ประเภทลิงก์ไม่ถูกต้อง';
  end if;
  if p_link_type = 'url' and (p_link_url is null or btrim(p_link_url) !~ '^https://[^\s]+$') then
    raise exception 'ลิงก์ต้องขึ้นต้นด้วย https://';
  end if;
  if p_link_type = 'menu' and (p_link_menu is null or p_link_menu !~ '^/[a-z0-9/_-]*$') then
    raise exception 'กรุณาเลือกเมนูที่จะไป';
  end if;

  if p_id is null then
    insert into public.announcements (title, image_path, link_type, link_url, link_menu, starts_on, ends_on)
    values (btrim(p_title), p_image_path, p_link_type,
            case when p_link_type = 'url' then btrim(p_link_url) end,
            case when p_link_type = 'menu' then p_link_menu end, p_starts, p_ends)
    returning id into v_id;
  else
    update public.announcements set
      title = btrim(p_title), image_path = p_image_path, link_type = p_link_type,
      link_url = case when p_link_type = 'url' then btrim(p_link_url) end,
      link_menu = case when p_link_type = 'menu' then p_link_menu end,
      starts_on = p_starts, ends_on = p_ends, updated_at = now()
    where id = p_id and deleted_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'ไม่พบประกาศนี้';
    end if;
  end if;
  return v_id;
end $$;

-- ลบประกาศ (เก็บประวัติไว้ ไม่ลบจริง)
create function public.delete_announcement(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.role_rank(public.my_role()), 0) < 2 then
    raise exception 'ไม่มีสิทธิ์จัดการประชาสัมพันธ์';
  end if;
  update public.announcements set deleted_at = now(), deleted_by = (select auth.uid())
  where id = p_id and deleted_at is null;
  if not found then
    raise exception 'ไม่พบประกาศนี้';
  end if;
end $$;

revoke execute on function public.save_announcement(uuid, text, text, text, text, text, date, date), public.delete_announcement(uuid) from public, anon;
grant execute on function public.save_announcement(uuid, text, text, text, text, text, date, date), public.delete_announcement(uuid) to authenticated;

-- ---------- ที่เก็บภาพประกาศ (แบบปิด: เห็นเฉพาะคนที่ล็อกอิน) · ข้ามในฐานข้อมูลจำลองที่ไม่มี storage ----------
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('announcements', 'announcements', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute $p$
    create policy announcement_files_read on storage.objects for select to authenticated
    using (bucket_id = 'announcements')
  $p$;
  execute $p$
    create policy announcement_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'announcements' and coalesce(public.role_rank((select public.my_role())), 0) >= 2
                and name ~ '^[0-9a-f-]{36}\.(webp|jpg|png)$')
  $p$;
  execute $p$
    create policy announcement_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'announcements' and coalesce(public.role_rank((select public.my_role())), 0) >= 2
           and not exists (select 1 from public.announcements a where a.image_path = name and a.deleted_at is null))
  $p$;
end $$;

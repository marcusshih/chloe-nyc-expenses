-- Upgrade 001_trip.sql. Run as the database owner in the Supabase SQL Editor.
-- Back up first: the selected NYC trip's expenses become intentionally public.
begin;

-- Remove callable account/invitation entry points and their dependent policies.
drop function if exists public.create_trip(text);
drop function if exists public.create_invitation(uuid,text);
drop function if exists public.accept_invitation(text);
drop policy if exists trip_read on public.trips;
drop policy if exists members_read on public.trip_members;
drop policy if exists expense_read on public.expenses;
drop policy if exists expense_insert on public.expenses;
drop policy if exists expense_update on public.expenses;
drop policy if exists expense_delete on public.expenses;
drop function if exists public.is_trip_member(uuid);
drop trigger if exists member_joined on public.trip_members;
drop function if exists public.notify_members();

-- Keep legacy records for the owner, but deny browser access, including old
-- authenticated sessions. Table REVOKE alone does not remove column grants.
revoke all on public.trips, public.trip_members, public.trip_invitations,
 public.expenses from public, anon, authenticated;
revoke insert(trip_id,title,amount_cents,expense_date,category,paid_by,split_type,notes),
 update(title,amount_cents,expense_date,category,paid_by,split_type,notes)
 on public.expenses from authenticated;

alter table public.trips alter column created_by drop not null;
alter table public.expenses alter column created_by drop not null;
alter table public.expenses alter column created_by drop default;

-- One stable, non-secret trip ID shared by all browsers. Preserve expenses from
-- the existing NYC trip. Refuse an ambiguous merge rather than publish more data.
do $$
declare source_id uuid; candidates integer;
begin
 select count(*), (array_agg(id))[1] into candidates, source_id
 from public.trips
 where id <> '20261104-0000-4000-8000-000000000001'
   and name = 'NYC with Chloe ♡'
   and starts_on = '2026-11-04' and ends_on = '2026-11-09';
 if candidates > 1 then
  raise exception 'Multiple NYC trips found. Select and consolidate the intended trip as owner before rerunning; no changes have been committed.';
 end if;
 insert into public.trips(id,name,starts_on,ends_on)
 values('20261104-0000-4000-8000-000000000001','NYC with Chloe ♡','2026-11-04','2026-11-09')
 on conflict (id) do nothing;
 if source_id is not null then
  update public.expenses set trip_id='20261104-0000-4000-8000-000000000001'
  where trip_id=source_id;
 end if;
end $$;

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invitations enable row level security;
alter table public.expenses enable row level security;

-- Explicit columns avoid publishing legacy creator UUIDs. Trip metadata is private;
-- expense identity, timestamps, creator and trip assignment cannot be updated.
grant select(id,trip_id,title,amount_cents,expense_date,category,paid_by,split_type,notes,created_at,updated_at),
 insert(trip_id,title,amount_cents,expense_date,category,paid_by,split_type,notes),
 update(title,amount_cents,expense_date,category,paid_by,split_type,notes), delete
 on public.expenses to anon;

create policy shared_expense_read on public.expenses for select to anon
 using(trip_id='20261104-0000-4000-8000-000000000001');
create policy shared_expense_insert on public.expenses for insert to anon
 with check(trip_id='20261104-0000-4000-8000-000000000001' and created_by is null);
create policy shared_expense_update on public.expenses for update to anon
 using(trip_id='20261104-0000-4000-8000-000000000001')
 with check(trip_id='20261104-0000-4000-8000-000000000001');
create policy shared_expense_delete on public.expenses for delete to anon
 using(trip_id='20261104-0000-4000-8000-000000000001');

create or replace function public.touch_expense() returns trigger
language plpgsql set search_path = '' as $$
begin
 new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end; $$;

-- An UPDATE on a read-only counter invalidates expense lists on every device.
-- DELETE events on expenses are deliberately not published: they cannot apply
-- row-level authorization to a deleted row. This trigger also covers deletes.
create table public.expense_sync (
 trip_id uuid primary key references public.trips(id),
 revision bigint not null default 0,
 check(trip_id='20261104-0000-4000-8000-000000000001')
);
insert into public.expense_sync(trip_id)
 values('20261104-0000-4000-8000-000000000001');
alter table public.expense_sync enable row level security;
revoke all on public.expense_sync from public, anon, authenticated;
grant select on public.expense_sync to anon;
create policy shared_sync_read on public.expense_sync for select to anon
 using(trip_id='20261104-0000-4000-8000-000000000001');

create or replace function public.notify_expenses() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if coalesce(new.trip_id,old.trip_id)='20261104-0000-4000-8000-000000000001' then
  update public.expense_sync set revision=revision+1
  where trip_id='20261104-0000-4000-8000-000000000001';
 end if;
 return null;
end; $$;
revoke all on function public.touch_expense(),public.notify_expenses()
 from public, anon, authenticated;

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='expense_sync') then
  alter publication supabase_realtime add table public.expense_sync;
 end if;
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trips') then
  alter publication supabase_realtime drop table public.trips;
 end if;
 -- Never publish expense DELETEs or legacy creator columns via Realtime.
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='expenses') then
  alter publication supabase_realtime drop table public.expenses;
 end if;
end $$;

commit;

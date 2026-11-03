-- Run once in the Supabase SQL Editor on a new project.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.trips (
 id uuid primary key default gen_random_uuid(),
 name text not null default 'NYC with Chloe ♡',
 starts_on date not null default '2026-11-04', ends_on date not null default '2026-11-09',
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.trip_members (
 trip_id uuid not null references public.trips(id) on delete cascade,
 user_id uuid not null references auth.users(id), person text not null check (person in ('Marcus','Chloe')),
 primary key(trip_id,user_id), unique(trip_id,person), unique(user_id)
);
create table public.expenses (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id) on delete cascade,
 title text not null check (length(trim(title)) between 1 and 120),
 amount_cents integer not null check(amount_cents between 1 and 100000000),
 expense_date date not null check(expense_date between '2026-11-04' and '2026-11-09'),
 category text not null check(category in ('Food & Drinks','Transportation','Attractions','Shopping','Other')),
 paid_by text not null check(paid_by in ('Marcus','Chloe')),
 split_type text not null check(split_type in ('shared','marcus','chloe')),
 notes text not null default '' check(length(notes)<=2000),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index expenses_trip_date on public.expenses(trip_id,expense_date);
create table public.trip_invitations (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips(id) on delete cascade,
 email text not null, person text not null check(person in ('Marcus','Chloe')),
 token_hash bytea not null unique, expires_at timestamptz not null default now()+interval '48 hours',
 used_at timestamptz, created_by uuid not null references auth.users(id)
);
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.expenses enable row level security;
alter table public.trip_invitations enable row level security;
-- Definer avoids recursive membership policies. No arbitrary user parameter.
create function public.is_trip_member(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.trip_members where trip_id=p_trip and user_id=auth.uid());
$$;
revoke all on function public.is_trip_member(uuid) from public, anon;
grant execute on function public.is_trip_member(uuid) to authenticated;
create policy trip_read on public.trips for select to authenticated using(public.is_trip_member(id));
create policy members_read on public.trip_members for select to authenticated using(public.is_trip_member(trip_id));
create policy expense_read on public.expenses for select to authenticated using(public.is_trip_member(trip_id));
create policy expense_insert on public.expenses for insert to authenticated with check(public.is_trip_member(trip_id) and created_by=auth.uid());
create policy expense_update on public.expenses for update to authenticated using(public.is_trip_member(trip_id)) with check(public.is_trip_member(trip_id));
create policy expense_delete on public.expenses for delete to authenticated using(public.is_trip_member(trip_id));
-- No direct invitation policies: only scoped RPCs can read/write hashed tokens.
revoke all on public.trips,public.trip_members,public.expenses,public.trip_invitations from anon,authenticated;
grant select on public.trips,public.trip_members to authenticated;
grant select,delete on public.expenses to authenticated;
grant insert(trip_id,title,amount_cents,expense_date,category,paid_by,split_type,notes) on public.expenses to authenticated;
grant update(title,amount_cents,expense_date,category,paid_by,split_type,notes) on public.expenses to authenticated;
create function public.touch_expense() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at=now(); return new; end; $$;
create trigger expense_updated before update on public.expenses for each row execute function public.touch_expense();
create function public.create_trip(p_person text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
 if auth.uid() is null or p_person not in ('Marcus','Chloe') then raise exception 'Sign in and choose your name.'; end if;
 if exists(select 1 from public.trip_members where user_id=auth.uid()) then raise exception 'You already belong to a trip.'; end if;
 insert into public.trips(created_by) values(auth.uid()) returning id into t;
 insert into public.trip_members values(t,auth.uid(),p_person);
 return t;
end; $$;
create function public.create_invitation(p_trip uuid,p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare token text; other_person text;
begin
 -- Lock trip to serialize invitation creation and acceptance.
 perform 1 from public.trips where id=p_trip for update;
 if not exists(select 1 from public.trips where id=p_trip and created_by=auth.uid()) then raise exception 'Only the trip creator can invite.'; end if;
 if length(trim(p_email))>254 or trim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email.'; end if;
 if (select count(*) from public.trip_members where trip_id=p_trip)>=2 then raise exception 'Both travelers have joined.'; end if;
 select case person when 'Marcus' then 'Chloe' else 'Marcus' end into other_person from public.trip_members where trip_id=p_trip and user_id=auth.uid();
 update public.trip_invitations set used_at=now() where trip_id=p_trip and used_at is null;
 token=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.trip_invitations(trip_id,email,person,token_hash,created_by)
 values(p_trip,lower(trim(p_email)),other_person,extensions.digest(token,'sha256'),auth.uid());
 return token;
end; $$;
create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation public.trip_invitations; account_email text;
begin
 if auth.uid() is null then raise exception 'Sign in first.'; end if;
 select email into account_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into invitation from public.trip_invitations where token_hash=extensions.digest(p_token,'sha256');
 if invitation.id is null then raise exception 'Invitation is invalid.'; end if;
 perform 1 from public.trips where id=invitation.trip_id for update;
 select * into invitation from public.trip_invitations where id=invitation.id for update;
 if invitation.used_at is not null or invitation.expires_at<=now() or lower(account_email) is distinct from invitation.email then raise exception 'Invitation is expired, used, or belongs to a different email.'; end if;
 if exists(select 1 from public.trip_members where user_id=auth.uid()) then raise exception 'You already belong to a trip.'; end if;
 insert into public.trip_members values(invitation.trip_id,auth.uid(),invitation.person);
 update public.trip_invitations set used_at=now() where id=invitation.id;
 return invitation.trip_id;
end; $$;
revoke all on function public.create_trip(text),public.create_invitation(uuid,text),public.accept_invitation(text) from public,anon;
grant execute on function public.create_trip(text),public.create_invitation(uuid,text),public.accept_invitation(text) to authenticated;
-- Realtime uses RLS-authorized trip updates as invalidations, including deletes.
-- This avoids relying on filtered DELETE events (which lack full row data).
create function public.notify_expenses() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 perform pg_notify('trip_expenses',coalesce(new.trip_id,old.trip_id)::text);
 update public.trips set name=name where id=coalesce(new.trip_id,old.trip_id);
 return null;
end; $$;
create trigger expense_changed after insert or update or delete on public.expenses for each row execute function public.notify_expenses();
create function public.notify_members() returns trigger language plpgsql security definer set search_path = '' as $$
begin update public.trips set name=name where id=new.trip_id; return null; end; $$;
create trigger member_joined after insert on public.trip_members for each row execute function public.notify_members();
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trips') then
 alter publication supabase_realtime add table public.trips;
 end if;
end $$;

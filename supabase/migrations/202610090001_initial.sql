-- ZERO BET: initial schema for a NEW Supabase project.
-- Does not import/delete Firebase data or activate the application integration.
-- Execute as project owner in Supabase SQL Editor. Transactional and repeatable.
begin;
create schema if not exists zerobet_private;
revoke all on schema zerobet_private from public, anon;
grant usage on schema zerobet_private to authenticated, service_role;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 account_id bigint generated always as identity unique,
 display_name text not null default 'Jogador', phone text, cpf text, birth_date date,
 role text not null default 'player' check(role in ('player','admin')),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','BLOCKED')),
 kyc_status text not null default 'NOT_STARTED' check(kyc_status in ('NOT_STARTED','PENDING','APPROVED','REJECTED')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create or replace function zerobet_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and status='ACTIVE');
$$;
revoke all on function zerobet_private.is_admin() from public, anon;
grant execute on function zerobet_private.is_admin() to authenticated, service_role;

create table if not exists public.wallets (
 user_id uuid primary key references public.profiles(id) on delete restrict,
 balance_cents bigint not null default 0 check(balance_cents >= 0),
 bonus_cents bigint not null default 0 check(bonus_cents >= 0),
 currency text not null default 'BRL' check(currency='BRL'), updated_at timestamptz not null default now()
);
create table if not exists public.wallet_entries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete restrict,
 amount_cents bigint not null check(amount_cents<>0), balance_after_cents bigint not null check(balance_after_cents>=0),
 kind text not null check(kind in ('DEPOSIT','WITHDRAWAL','BET','WIN','REFUND','ADJUSTMENT','COMMISSION','BONUS')),
 idempotency_key text not null unique, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.payment_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete restrict,
 kind text not null check(kind in ('DEPOSIT','WITHDRAWAL','FEE')), amount_cents bigint not null check(amount_cents>0),
 status text not null default 'PENDING' check(status in ('PENDING','PAID','APPROVED','REJECTED','CANCELLED','EXPIRED')),
 external_id text unique, metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.game_transactions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete restrict,
 provider text not null, game_code text not null, external_id text not null unique,
 bet_cents bigint not null default 0 check(bet_cents>=0), win_cents bigint not null default 0 check(win_cents>=0),
 metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.favorites (
 user_id uuid not null references public.profiles(id) on delete cascade, game_key text not null,
 created_at timestamptz not null default now(), primary key(user_id,game_key)
);
create table if not exists public.user_notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 title text not null, body text not null default '', read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.support_tickets (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete restrict,
 subject text not null check(length(subject) between 1 and 160), message text not null check(length(message) between 1 and 10000),
 status text not null default 'OPEN' check(status in ('OPEN','IN_PROGRESS','CLOSED')), created_at timestamptz not null default now()
);
create table if not exists public.affiliates (
 user_id uuid primary key references public.profiles(id) on delete restrict, code text not null unique,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','BLOCKED')), commission_cents bigint not null default 0 check(commission_cents>=0),
 clicks bigint not null default 0 check(clicks>=0), registrations bigint not null default 0 check(registrations>=0), created_at timestamptz not null default now()
);
create table if not exists public.referrals (
 user_id uuid primary key references public.profiles(id) on delete restrict, affiliate_id uuid not null references public.affiliates(user_id) on delete restrict,
 created_at timestamptz not null default now(), check(user_id<>affiliate_id)
);
create table if not exists public.responsible_limits (
 user_id uuid primary key references public.profiles(id) on delete restrict,
 daily_deposit_cents bigint check(daily_deposit_cents>=0), weekly_deposit_cents bigint check(weekly_deposit_cents>=0), monthly_deposit_cents bigint check(monthly_deposit_cents>=0),
 session_minutes integer check(session_minutes>0), self_excluded_until timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.bonuses (
 id uuid primary key default gen_random_uuid(), title text not null, active boolean not null default false,
 rules jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists public.bonus_grants (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete restrict,
 bonus_id uuid references public.bonuses(id) on delete restrict, amount_cents bigint not null check(amount_cents>=0),
 status text not null default 'ACTIVE', idempotency_key text not null unique, created_at timestamptz not null default now()
);
create table if not exists public.banner_campaigns (
 id uuid primary key default gen_random_uuid(), title text not null, placement text not null, image_path text not null,
 active boolean not null default false, position integer not null default 0, action jsonb not null default '{}', targeting jsonb not null default '{}',
 starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now()
);
-- Only public appearance/layout values go here. Gateway/provider secrets stay on server.
create table if not exists public.platform_config (
 key text primary key check(key in ('theme','home_layout','public_settings')), value jsonb not null default '{}', updated_at timestamptz not null default now()
);
create table if not exists public.admin_audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete restrict,
 action text not null, target_id text, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);

create or replace function zerobet_private.provision_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,display_name) values(new.id,coalesce(nullif(left(new.raw_user_meta_data->>'displayName',120),''),'Jogador')) on conflict(id) do nothing;
 insert into public.wallets(user_id) values(new.id) on conflict(user_id) do nothing;
 return new;
end;
$$;
revoke all on function zerobet_private.provision_user() from public, anon, authenticated;
drop trigger if exists zerobet_user_created on auth.users;
create trigger zerobet_user_created after insert on auth.users for each row execute function zerobet_private.provision_user();
-- Supports any test Auth users created before this script, without importing balances/roles.
insert into public.profiles(id,display_name) select id,coalesce(nullif(left(raw_user_meta_data->>'displayName',120),''),'Jogador') from auth.users on conflict(id) do nothing;
insert into public.wallets(user_id) select id from public.profiles on conflict(user_id) do nothing;

-- Every financial and administrative write is SERVER ONLY.
-- Admin browser receives read access, never permission to bypass the financial backend.
do $$
declare t text;
begin
 foreach t in array array['profiles','wallets','wallet_entries','payment_requests','game_transactions','favorites','user_notifications','support_tickets','affiliates','referrals','responsible_limits','bonuses','bonus_grants','banner_campaigns','platform_config','admin_audit_logs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select, insert, update, delete on public.%I to service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists zerobet_admin_read on public.%I',t);
  execute format('create policy zerobet_admin_read on public.%I for select to authenticated using ((select zerobet_private.is_admin()))',t);
 end loop;
 foreach t in array array['wallets','wallet_entries','payment_requests','game_transactions','favorites','user_notifications','support_tickets','affiliates','referrals','responsible_limits','bonus_grants'] loop
  execute format('drop policy if exists zerobet_own_read on public.%I',t);
  execute format('create policy zerobet_own_read on public.%I for select to authenticated using (user_id=(select auth.uid()))',t);
 end loop;
end $$;
grant usage, select on sequence public.profiles_account_id_seq to service_role;
drop policy if exists zerobet_profile_read on public.profiles;
create policy zerobet_profile_read on public.profiles for select to authenticated using(id=(select auth.uid()));
-- Column grants prevent changing role/status/KYC via a normal user's browser.
grant update(display_name,phone,birth_date) on public.profiles to authenticated;
drop policy if exists zerobet_profile_update on public.profiles;
create policy zerobet_profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
grant insert,delete on public.favorites to authenticated;
drop policy if exists zerobet_favorite_insert on public.favorites;
create policy zerobet_favorite_insert on public.favorites for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists zerobet_favorite_delete on public.favorites;
create policy zerobet_favorite_delete on public.favorites for delete to authenticated using(user_id=(select auth.uid()));
grant update(read_at) on public.user_notifications to authenticated;
drop policy if exists zerobet_notification_update on public.user_notifications;
create policy zerobet_notification_update on public.user_notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant insert(user_id,subject,message) on public.support_tickets to authenticated;
drop policy if exists zerobet_ticket_insert on public.support_tickets;
create policy zerobet_ticket_insert on public.support_tickets for insert to authenticated with check(user_id=(select auth.uid()));
grant select on public.bonuses, public.banner_campaigns, public.platform_config to anon;
drop policy if exists zerobet_active_bonus on public.bonuses;
create policy zerobet_active_bonus on public.bonuses for select to anon,authenticated using(active);
drop policy if exists zerobet_active_banner on public.banner_campaigns;
create policy zerobet_active_banner on public.banner_campaigns for select to anon,authenticated using(active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()));
drop policy if exists zerobet_public_config on public.platform_config;
create policy zerobet_public_config on public.platform_config for select to anon,authenticated using(true);

create index if not exists wallet_entries_user_created on public.wallet_entries(user_id,created_at desc);
create index if not exists payment_requests_user_created on public.payment_requests(user_id,created_at desc);
create index if not exists game_transactions_user_created on public.game_transactions(user_id,created_at desc);
create index if not exists notifications_user_created on public.user_notifications(user_id,created_at desc);
create index if not exists tickets_user_created on public.support_tickets(user_id,created_at desc);
create index if not exists bonus_grants_user_created on public.bonus_grants(user_id,created_at desc);
create index if not exists referrals_affiliate on public.referrals(affiliate_id);
create index if not exists banners_placement on public.banner_campaigns(placement,position);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('zerobet-banners','zerobet-banners',true,10485760,array['image/png','image/jpeg','image/webp']),
 ('zerobet-kyc','zerobet-kyc',false,10485760,array['image/png','image/jpeg','application/pdf'])
on conflict(id) do nothing;
drop policy if exists zerobet_banner_upload on storage.objects;
create policy zerobet_banner_upload on storage.objects for insert to authenticated with check(bucket_id='zerobet-banners' and (select zerobet_private.is_admin()));
drop policy if exists zerobet_banner_manage on storage.objects;
create policy zerobet_banner_manage on storage.objects for select to authenticated using(bucket_id='zerobet-banners' and (select zerobet_private.is_admin()));
drop policy if exists zerobet_banner_update on storage.objects;
create policy zerobet_banner_update on storage.objects for update to authenticated using(bucket_id='zerobet-banners' and (select zerobet_private.is_admin())) with check(bucket_id='zerobet-banners' and (select zerobet_private.is_admin()));
drop policy if exists zerobet_banner_delete on storage.objects;
create policy zerobet_banner_delete on storage.objects for delete to authenticated using(bucket_id='zerobet-banners' and (select zerobet_private.is_admin()));
drop policy if exists zerobet_kyc_upload on storage.objects;
create policy zerobet_kyc_upload on storage.objects for insert to authenticated with check(bucket_id='zerobet-kyc' and (storage.foldername(name))[1]=(select auth.uid()::text));
drop policy if exists zerobet_kyc_read on storage.objects;
create policy zerobet_kyc_read on storage.objects for select to authenticated using(bucket_id='zerobet-kyc' and ((storage.foldername(name))[1]=(select auth.uid()::text) or (select zerobet_private.is_admin())));
-- KYC objects cannot be overwritten/deleted by players after submission.

-- Enable live updates only for scoped account data. RLS remains active.
do $$
declare t text;
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['profiles','wallets','payment_requests','user_notifications'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
commit;

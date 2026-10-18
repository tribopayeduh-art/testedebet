begin;
alter table public.affiliates add column if not exists settings jsonb not null default '{}';
create table if not exists public.notification_campaigns (
 id uuid primary key default gen_random_uuid(), title text not null, body text not null,
 audience text not null check(audience in ('ALL','ACTIVE','DEPOSITORS','VIP')),
 channel text not null default 'IN_APP' check(channel='IN_APP'),
 status text not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED')),
 delivered integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.game_overrides(game_key text primary key,config jsonb not null default '{}',updated_at timestamptz not null default now());
do $$ declare t text; begin
 foreach t in array array['notification_campaigns','game_overrides'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists zerobet_admin_read on public.%I',t);
  execute format('create policy zerobet_admin_read on public.%I for select to authenticated using ((select zerobet_private.is_admin()))',t);
 end loop;
end $$;
grant select on public.game_overrides to anon;
drop policy if exists zerobet_public_game_overrides on public.game_overrides;
create policy zerobet_public_game_overrides on public.game_overrides for select to anon,authenticated using(true);
create or replace function public.zerobet_admin_tool(p_operation text,p_id text default null,p_patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare campaign public.notification_campaigns; n integer; result_id uuid; uid uuid; result jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(90510005);
 if not zerobet_private.is_admin() then raise exception 'Acesso administrativo obrigatório' using errcode='42501'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>32768 then raise exception 'Dados inválidos'; end if;
 if p_operation='NOTIFICATION_CREATE' then
  if coalesce(p_patch->>'channel','IN_APP')<>'IN_APP' then raise exception 'Configure um serviço de envio antes de utilizar PUSH ou EMAIL'; end if;
  if length(btrim(coalesce(p_patch->>'title',''))) not between 1 and 160 or length(coalesce(p_patch->>'body','')) not between 1 and 10000 then raise exception 'Informe título e mensagem válidos'; end if;
  insert into public.notification_campaigns(title,body,audience) values(p_patch->>'title',p_patch->>'body',coalesce(p_patch->>'audience','ALL')) returning id into result_id;
  result:=jsonb_build_object('id',result_id);
 elsif p_operation='NOTIFICATION_PUBLISH' then
  select * into campaign from public.notification_campaigns where id=p_id::uuid for update;
  if not found then raise exception 'Campanha não encontrada'; end if;
  if campaign.status='PUBLISHED' then return jsonb_build_object('id',campaign.id,'delivered',campaign.delivered); end if;
  insert into public.user_notifications(user_id,title,body)
   select id,campaign.title,campaign.body from public.profiles p where p.role='player' and (
    campaign.audience='ALL' or (campaign.audience='ACTIVE' and p.status='ACTIVE') or
    (campaign.audience='VIP' and p.admin_metadata->>'influencer'='true') or
    (campaign.audience='DEPOSITORS' and exists(select 1 from public.payment_requests r where r.user_id=p.id and r.kind='DEPOSIT' and r.status='PAID')));
  get diagnostics n=row_count;
  update public.notification_campaigns set status='PUBLISHED',delivered=n where id=campaign.id;
  result:=jsonb_build_object('id',campaign.id,'delivered',n);
 elsif p_operation='AFFILIATE_SAVE' then
  uid:=(p_patch->>'uid')::uuid;
  if length(coalesce(p_patch->>'code','')) not between 3 and 64 or (p_patch->>'code') !~ '^[A-Za-z0-9_-]+$' then raise exception 'Código de afiliado inválido'; end if;
  if coalesce((p_patch->>'commissionPercent')::numeric,-1) not between 0 and 100 then raise exception 'Comissão deve estar entre 0 e 100'; end if;
  if coalesce(p_patch->>'model','DEPOSIT') not in ('DEPOSIT','GGR','CPA','REVSHARE') then raise exception 'Modelo de comissão inválido'; end if;
  insert into public.affiliates(user_id,code,status,settings) values(uid,p_patch->>'code',coalesce(p_patch->>'status','ACTIVE'),jsonb_build_object('commissionPercent',p_patch->'commissionPercent','model',p_patch->>'model'))
  on conflict(user_id) do update set code=excluded.code,status=excluded.status,settings=excluded.settings;
  result:=jsonb_build_object('uid',uid);
 elsif p_operation='GAME_OVERRIDE' then
  if exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('enabled','featured','customName','customImage','category','sortOrder','rtp')) then raise exception 'Campo de jogo inválido'; end if;
  if length(coalesce(p_id,'')) not between 1 and 256 then raise exception 'Jogo inválido'; end if;
  insert into public.game_overrides(game_key,config) values(p_id,p_patch) on conflict(game_key) do update set config=public.game_overrides.config||excluded.config,updated_at=now();
  result:=jsonb_build_object('key',p_id);
 else raise exception 'Operação inválida'; end if;
 insert into public.admin_audit_logs(actor_id,action,target_id,metadata) values(auth.uid(),p_operation,coalesce(result_id::text,p_id,uid::text),result);
 return result;
end $$;
revoke all on function public.zerobet_admin_tool(text,text,jsonb) from public,anon;
grant execute on function public.zerobet_admin_tool(text,text,jsonb) to authenticated;
create or replace function public.zerobet_admin_report() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not zerobet_private.is_admin() then raise exception 'Acesso administrativo obrigatório' using errcode='42501'; end if;
 with days as(select generate_series((current_timestamp at time zone 'America/Sao_Paulo')::date-29,(current_timestamp at time zone 'America/Sao_Paulo')::date,interval '1 day')::date as day),
 users_by_day as(select (created_at at time zone 'America/Sao_Paulo')::date as day,count(*) registrations from public.profiles group by 1),
 payments as(select (created_at at time zone 'America/Sao_Paulo')::date as day,sum(case when kind='DEPOSIT' then amount_cents else 0 end)/100.0 deposits,sum(case when kind='WITHDRAWAL' then amount_cents else 0 end)/100.0 withdraws from public.payment_requests where status='PAID' group by 1),
 games as(select (created_at at time zone 'America/Sao_Paulo')::date as day,sum(bet_cents)/100.0 bets,sum(win_cents)/100.0 wins from public.game_transactions group by 1),
 daily as(select d.day as date,coalesce(u.registrations,0) registrations,coalesce(p.deposits,0) deposits,coalesce(p.withdraws,0) withdraws,coalesce(g.bets,0) bets,coalesce(g.wins,0) wins from days d left join users_by_day u using(day) left join payments p using(day) left join games g using(day))
 select jsonb_build_object('daily',jsonb_agg(to_jsonb(daily) order by date desc),'totals',jsonb_build_object('users',(select count(*) from public.profiles),'registrations',sum(registrations),'deposits',sum(deposits),'withdraws',sum(withdraws),'ggr',sum(bets-wins),'affiliates',(select count(*) from public.affiliates))) into result from daily;
 return result;
end $$;
revoke all on function public.zerobet_admin_report() from public,anon;
grant execute on function public.zerobet_admin_report() to authenticated;
commit;

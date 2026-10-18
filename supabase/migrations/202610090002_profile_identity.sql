-- Persist registration identity for admin views. No balances, roles or KYC approvals change.
-- Run in the SQL Editor AFTER the initial schema.
begin;
alter table public.profiles add column if not exists email text;
create or replace function zerobet_private.provision_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare phone_value text; cpf_value text;
begin
 phone_value:=nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''),'[^0-9]','','g'),'');
 cpf_value:=nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'cpf',''),'[^0-9]','','g'),'');
 if length(phone_value) not between 10 and 11 then phone_value:=null; end if;
 if length(cpf_value)<>11 then cpf_value:=null; end if;
 insert into public.profiles(id,email,display_name,phone,cpf)
 values(new.id,new.email,coalesce(nullif(left(new.raw_user_meta_data->>'displayName',120),''),'Jogador'),phone_value,cpf_value)
 on conflict(id) do nothing;
 insert into public.wallets(user_id) values(new.id) on conflict(user_id) do nothing;
 return new;
end;
$$;
revoke all on function zerobet_private.provision_user() from public,anon,authenticated;
create or replace function zerobet_private.sync_auth_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 update public.profiles set email=new.email,updated_at=now() where id=new.id;
 return new;
end;
$$;
revoke all on function zerobet_private.sync_auth_email() from public,anon,authenticated;
drop trigger if exists zerobet_auth_email_updated on auth.users;
create trigger zerobet_auth_email_updated after update of email on auth.users for each row execute function zerobet_private.sync_auth_email();
update public.profiles p set email=a.email,
 phone=coalesce(nullif(p.phone,''),case when length(regexp_replace(coalesce(a.raw_user_meta_data->>'phone',''),'[^0-9]','','g')) between 10 and 11 then regexp_replace(a.raw_user_meta_data->>'phone','[^0-9]','','g') end),
 cpf=coalesce(nullif(p.cpf,''),case when length(regexp_replace(coalesce(a.raw_user_meta_data->>'cpf',''),'[^0-9]','','g'))=11 then regexp_replace(a.raw_user_meta_data->>'cpf','[^0-9]','','g') end)
from auth.users a where a.id=p.id;
-- Claimed CPF is stored, never treated as verified or used to approve KYC automatically.
commit;

begin;
alter table public.profiles add column if not exists admin_metadata jsonb not null default '{}';
create or replace function public.zerobet_player_admin(p_operation text,p_id uuid,p_patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid();
 player public.profiles;
 wallet public.wallets;
 entry public.wallet_entries;
 mode_value text;
 cents bigint;
 delta bigint;
 after_value bigint;
 operation_key text;
 reason_value text;
 metadata_value jsonb;
 status_value text;
 role_value text;
 kyc_value text;
 key_name text;
 result jsonb;
begin
 -- Serialize administrative writes, including role changes and retries.
 perform pg_catalog.pg_advisory_xact_lock(90510005);
 if not zerobet_private.is_admin() then raise exception 'Acesso administrativo obrigatório' using errcode='42501'; end if;
 if p_id is null or p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>32768 then raise exception 'Dados inválidos' using errcode='22023'; end if;
 select * into player from public.profiles where id=p_id for update;
 if not found then raise exception 'Jogador não encontrado' using errcode='P0002'; end if;
 if p_operation='WALLET' then
  mode_value:=p_patch->>'mode';
  if mode_value not in ('SET','CREDIT','DEBIT','INCREMENT') or mode_value is null then raise exception 'Modo inválido'; end if;
  if coalesce(p_patch->>'amountCents','') !~ '^[0-9]{1,9}$' then raise exception 'Valor inválido'; end if;
  cents:=(p_patch->>'amountCents')::bigint;
  if cents>100000000 or (mode_value<>'SET' and cents=0) then raise exception 'Valor inválido'; end if;
  reason_value:=btrim(coalesce(p_patch->>'reason',''));
  if length(reason_value) not between 1 and 500 then raise exception 'Informe um motivo com até 500 caracteres'; end if;
  if length(coalesce(p_patch->>'key','')) not between 8 and 128 then raise exception 'Chave de operação inválida'; end if;
  operation_key:='admin:'||actor::text||':'||(p_patch->>'key');
  select * into wallet from public.wallets where user_id=p_id for update;
  if not found then raise exception 'Carteira não encontrada'; end if;
  select * into entry from public.wallet_entries where idempotency_key=operation_key;
  if found then
   if entry.user_id<>p_id or entry.metadata->'request'<>p_patch then raise exception 'Chave já utilizada para outra operação'; end if;
   return entry.metadata->'result';
  end if;
  after_value:=case when mode_value='SET' then cents when mode_value='DEBIT' then wallet.balance_cents-cents else wallet.balance_cents+cents end;
  if after_value<0 then raise exception 'Saldo insuficiente para o débito'; end if;
  delta:=after_value-wallet.balance_cents;
  result:=jsonb_build_object('before',wallet.balance_cents/100.0,'after',after_value/100.0,'amount',delta/100.0,'walletBalance',after_value/100.0,'bonusBalance',wallet.bonus_cents/100.0);
  if delta=0 then raise exception 'O saldo já está no valor informado'; end if;
  update public.wallets set balance_cents=after_value,updated_at=now() where user_id=p_id;
  insert into public.wallet_entries(user_id,amount_cents,balance_after_cents,kind,idempotency_key,metadata)
  values(p_id,delta,after_value,'ADJUSTMENT',operation_key,jsonb_build_object('actorUid',actor,'reason',reason_value,'before',wallet.balance_cents/100.0,'after',after_value/100.0,'request',p_patch,'result',result,'administrativeBonus',coalesce((p_patch->>'bonus')::boolean,false)));
  -- Manual bonuses in this existing screen are unrestricted real credits.
  if coalesce((p_patch->>'bonus')::boolean,false) then
   insert into public.bonus_grants(user_id,amount_cents,idempotency_key,status) values(p_id,delta,operation_key,'CREDITED');
  end if;
  metadata_value:=result||jsonb_build_object('reason',reason_value,'idempotencyKey',operation_key);
 elsif p_operation in ('PROFILE','RISK') then
  if p_operation='RISK' then
   p_patch:=case p_patch->>'action'
    when 'LOCK_WITHDRAW' then jsonb_build_object('withdrawLocked',true)
    when 'UNLOCK_WITHDRAW' then jsonb_build_object('withdrawLocked',false)
    when 'SUSPEND' then jsonb_build_object('status','BLOCKED')
    when 'ACTIVATE' then jsonb_build_object('status','ACTIVE')
    else null end;
   if p_patch is null then raise exception 'Ação de risco inválida'; end if;
  end if;
  role_value:=coalesce(p_patch->>'role',player.role);
  status_value:=coalesce(p_patch->>'status',player.status);
  if status_value in ('SUSPENDED','INACTIVE') then status_value:='BLOCKED'; end if;
  kyc_value:=coalesce(p_patch->>'kycStatus',player.kyc_status);
  if kyc_value='REVIEW' then kyc_value:='PENDING'; end if;
  if role_value not in ('player','admin') or status_value not in ('ACTIVE','BLOCKED') or kyc_value not in ('NOT_STARTED','PENDING','APPROVED','REJECTED') then raise exception 'Cargo, status ou KYC inválido'; end if;
  if player.role='admin' and player.status='ACTIVE' and (role_value<>'admin' or status_value<>'ACTIVE') and (select count(*) from public.profiles where role='admin' and status='ACTIVE')<=1 then raise exception 'Não é possível remover o último administrador ativo'; end if;
  if p_patch ? 'displayName' and length(btrim(p_patch->>'displayName')) not between 1 and 120 then raise exception 'Nome inválido'; end if;
  if p_patch ? 'cpf' and coalesce(p_patch->>'cpf','')<>'' and length(regexp_replace(p_patch->>'cpf','[^0-9]','','g'))<>11 then raise exception 'CPF deve ter 11 dígitos'; end if;
  if p_patch ? 'phone' and coalesce(p_patch->>'phone','')<>'' and length(regexp_replace(p_patch->>'phone','[^0-9]','','g')) not between 10 and 13 then raise exception 'Telefone inválido'; end if;
  metadata_value:=player.admin_metadata;
  foreach key_name in array array['influencer','withdrawLocked','firstWithdrawalFeePaid','kycApprovedFeePaid','accountApprovalFeePaid','antiFraudFeePaid','liquidationFeePaid','fullWithdrawalUnlocked','languageBonusClaimed'] loop
   if p_patch ? key_name then
    if jsonb_typeof(p_patch->key_name)<>'boolean' then raise exception 'Campo booleano inválido: %',key_name; end if;
    metadata_value:=metadata_value||jsonb_build_object(key_name,p_patch->key_name);
   end if;
  end loop;
  if p_patch ? 'notes' then
   if length(p_patch->>'notes')>10000 then raise exception 'Observações muito longas'; end if;
   metadata_value:=metadata_value||jsonb_build_object('notes',p_patch->'notes');
  end if;
  if p_patch ? 'tags' then
   if jsonb_typeof(p_patch->'tags')<>'array' or jsonb_array_length(p_patch->'tags')>50 then raise exception 'Tags inválidas'; end if;
   metadata_value:=metadata_value||jsonb_build_object('tags',p_patch->'tags');
  end if;
  update public.profiles set
   display_name=coalesce(p_patch->>'displayName',display_name),
   cpf=case when p_patch ? 'cpf' then nullif(regexp_replace(p_patch->>'cpf','[^0-9]','','g'),'') else cpf end,
   phone=case when p_patch ? 'phone' then nullif(regexp_replace(p_patch->>'phone','[^0-9]','','g'),'') else phone end,
   role=role_value,status=status_value,kyc_status=kyc_value,admin_metadata=metadata_value,updated_at=now()
  where id=p_id;
  result:=jsonb_build_object('uid',p_id,'status',status_value,'role',role_value,'kycStatus',kyc_value);
  metadata_value:=jsonb_build_object('fields',p_patch - 'cpf' - 'phone' - 'notes');
 else raise exception 'Operação inválida'; end if;
 insert into public.admin_audit_logs(actor_id,action,target_id,metadata) values(actor,'PLAYER_'||p_operation,p_id::text,metadata_value);
 return result;
end;
$$;
revoke all on function public.zerobet_player_admin(text,uuid,jsonb) from public,anon;
grant execute on function public.zerobet_player_admin(text,uuid,jsonb) to authenticated;
commit;

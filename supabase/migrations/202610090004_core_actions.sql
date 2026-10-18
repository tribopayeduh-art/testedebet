begin;
create or replace function zerobet_private.assert_public_config(value jsonb)
returns void language plpgsql set search_path='' as $$
declare item record; child jsonb;
begin
 if jsonb_typeof(value)='object' then
  for item in select * from jsonb_each(value) loop
   if item.key ~* '(secret|password|credential|private.?key|api.?key|access.?token|agent.?token|authorization)' then
    raise exception 'Credenciais devem permanecer na configuração privada do servidor' using errcode='22023';
   end if;
   perform zerobet_private.assert_public_config(item.value);
  end loop;
 elsif jsonb_typeof(value)='array' then
  for child in select * from jsonb_array_elements(value) loop
   perform zerobet_private.assert_public_config(child);
  end loop;
 end if;
end;
$$;
revoke all on function zerobet_private.assert_public_config(jsonb) from public,anon,authenticated;
create or replace function public.zerobet_core_action(
 p_operation text,p_id uuid default null,p_patch jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); result_id uuid; prior public.responsible_limits;
 rule_data jsonb; excluded_until timestamptz;
begin
 if actor is null then raise exception 'Autenticação obrigatória' using errcode='42501'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>32768 then
  raise exception 'Dados inválidos' using errcode='22023';
 end if;
 if not exists(select 1 from public.profiles where id=actor and status='ACTIVE') then
  raise exception 'Conta bloqueada' using errcode='42501';
 end if;
 if p_operation in ('RESPONSIBLE_LIMITS','SELF_EXCLUSION') then
  perform 1 from public.profiles where id=actor for update;
  insert into public.responsible_limits(user_id) values(actor) on conflict do nothing;
  select * into prior from public.responsible_limits where user_id=actor for update;
  if p_operation='RESPONSIBLE_LIMITS' then
   update public.responsible_limits set
    daily_deposit_cents=case when p_patch ? 'dailyDeposit' then round((p_patch->>'dailyDeposit')::numeric*100)::bigint else prior.daily_deposit_cents end,
    weekly_deposit_cents=case when p_patch ? 'weeklyDeposit' then round((p_patch->>'weeklyDeposit')::numeric*100)::bigint else prior.weekly_deposit_cents end,
    monthly_deposit_cents=case when p_patch ? 'monthlyDeposit' then round((p_patch->>'monthlyDeposit')::numeric*100)::bigint else prior.monthly_deposit_cents end,
    session_minutes=case when p_patch ? 'sessionMinutes' then (p_patch->>'sessionMinutes')::integer else prior.session_minutes end,
    updated_at=now() where user_id=actor;
  else
   excluded_until:=nullif(p_patch->>'until','')::timestamptz;
   if excluded_until is null or excluded_until<=now() then
    raise exception 'Selecione uma data futura para a autoexclusão' using errcode='22023';
   end if;
   if prior.self_excluded_until>excluded_until then
    raise exception 'Uma autoexclusão ativa não pode ser reduzida' using errcode='22023';
   end if;
   update public.responsible_limits set self_excluded_until=excluded_until,updated_at=now() where user_id=actor;
  end if;
  result_id:=actor;
 else
  if not zerobet_private.is_admin() then raise exception 'Acesso administrativo obrigatório' using errcode='42501'; end if;
  if p_operation in ('PUBLIC_SETTINGS','HOME_LAYOUT') then
   perform zerobet_private.assert_public_config(p_patch);
   if p_operation='HOME_LAYOUT' and jsonb_typeof(p_patch->'sections') is distinct from 'array' then
    raise exception 'Seções da home inválidas' using errcode='22023';
   end if;
   insert into public.platform_config(key,value)
   values(case when p_operation='HOME_LAYOUT' then 'home_layout' else 'public_settings' end,p_patch)
   on conflict(key) do update set value=public.platform_config.value||excluded.value,updated_at=now();
   if p_operation='PUBLIC_SETTINGS' and jsonb_typeof(p_patch->'visualTheme')='object' then
    insert into public.platform_config(key,value) values('theme',p_patch->'visualTheme')
    on conflict(key) do update set value=public.platform_config.value||excluded.value,updated_at=now();
   end if;
   result_id:=actor;
  elsif p_operation='SUPPORT_UPDATE' then
   if coalesce(p_patch->>'status','') not in ('OPEN','IN_PROGRESS','RESOLVED','CLOSED') then
    raise exception 'Status de atendimento inválido' using errcode='22023';
   end if;
   update public.support_tickets set status=p_patch->>'status' where id=p_id returning id into result_id;
  elsif p_operation='BONUS_CREATE' then
   if nullif(btrim(p_patch->>'title'),'') is null then raise exception 'Informe o título'; end if;
   insert into public.bonuses(title,active,rules)
   values(p_patch->>'title',coalesce((p_patch->>'active')::boolean,false),p_patch-array['id','title','active','createdAt']) returning id into result_id;
  elsif p_operation='BONUS_UPDATE' then
   select rules into rule_data from public.bonuses where id=p_id for update;
   update public.bonuses set
    title=coalesce(nullif(btrim(p_patch->>'title'),''),title),
    active=coalesce((p_patch->>'active')::boolean,active),
    rules=rule_data||(p_patch-array['id','title','active','createdAt'])
   where id=p_id returning id into result_id;
  elsif p_operation='BONUS_DELETE' then
   delete from public.bonuses where id=p_id returning id into result_id;
  else raise exception 'Operação inválida' using errcode='22023';
  end if;
  if result_id is null then raise exception 'Registro não encontrado' using errcode='P0002'; end if;
 end if;
 insert into public.admin_audit_logs(actor_id,action,target_id,metadata)
 values(actor,p_operation,result_id::text,'{}');
 return jsonb_build_object('id',result_id);
end;
$$;
revoke all on function public.zerobet_core_action(text,uuid,jsonb) from public,anon;
grant execute on function public.zerobet_core_action(text,uuid,jsonb) to authenticated;
insert into public.platform_config(key,value) values('public_settings','{"siteName":"ZeroBet","maintenance":false,"minDeposit":25,"maxDeposit":300,"minWithdraw":20,"maxWithdraw":20000,"withdrawKycRequired":false,"withdrawPixRequired":true,"popupEnabled":true,"popupImage":"/banners/desafio-tiger-mobile.png","popupTarget":"games","popupFrequency":"SESSION","firstDepositBonusPercent":300,"homeBannerEnabled":true,"homeBannerImage":"/banners/bannerborah1.png","supportUrl":"","termsUrl":"","privacyUrl":"","responsibleGamingUrl":"","languageBonusEnabled":true,"languageBonusAmountBRL":1090,"languageBonusRussiaDisplay":18000,"languageBonusJapanDisplay":30000,"languageBonusOncePerUser":true,"languageBonusRussianMessage":"Вы получили бонус 1 090 R$! Нажмите, чтобы забрать","languageBonusJapaneseMessage":"1,090 R$ のボーナスを受け取りました！請求するにはクリックしてください","languageBonusInfluencerBypass":true,"languageBonusRussiaEnabled":true,"languageBonusJapanEnabled":true,"languageBonusMinDeposit":30,"languageBonusNewAccountThreshold":100,"languageBonusHighFirstDepositThreshold":150,"languageBonusHighFirstDepositTrigger":100,"visualTheme":{"brandName":"ZeroBet","logoUrl":"/brand/zerobet-logo.svg","primaryColor":"#f50046","backgroundColor":"#000000","surfaceColor":"#111111","surfaceAltColor":"#1b1b1b","textColor":"#f7f5f8","mutedColor":"#8f8993","borderColor":"rgba(255,255,255,.07)","buttonTextColor":"#ffffff","borderRadius":14,"cardRadius":12,"compactMode":false,"navStyle":"FLOATING","gameCardRatio":"1:1","showProviderNames":true,"showBalanceLabel":true,"labels":{"home":"Início","casino":"Casino","deposit":"Depositar","profile":"Perfil","menu":"Menu"},"icons":{"menu":"","casino":"/icons/slot-machine.svg","home":"","deposit":"","profile":""}},"validationFees":{"languageFirstWithdrawal":{"enabled":true,"amount":32.9},"kycApproval":{"enabled":true,"amount":21.9},"accountApproval":{"enabled":true,"amount":19.67},"antiFraud":{"enabled":true,"amount":14.9},"liquidation":{"enabled":true,"amount":9.9}},"withdrawFeeRules":[{"id":"processing","label":"Processamento do saque","description":"Processamento e liquidação bancária PIX","enabled":false,"type":"FIXED","value":0,"triggerType":"ALWAYS"},{"id":"instant","label":"Saque instantâneo","description":"Fila prioritária e liberação rápida","enabled":false,"type":"PERCENT","value":0,"triggerType":"ALWAYS"},{"id":"priority","label":"Processamento prioritário","description":"Prioridade na fila de liquidação bancária","enabled":false,"type":"FIXED","value":0,"triggerType":"ALWAYS"},{"id":"first_payout","label":"Taxa de primeiro saque","description":"Verificação cadastral para novos sacadores","enabled":false,"type":"FIXED","value":0,"triggerType":"FIRST_WITHDRAWAL","withdrawalOccurrence":"FIRST_ONLY"},{"id":"risk_review","label":"Análise antifraude","description":"Verificação de conformidade e integridade","enabled":false,"type":"FIXED","value":0,"triggerType":"LOW_DEPOSITS","maxTotalDeposits":50},{"id":"bonus_release","label":"Taxa de liberação de bônus","description":"Processamento para contas com bônus resgatado","enabled":false,"type":"PERCENT","value":0,"triggerType":"LANGUAGE_BONUS","requireBonusClaimed":true},{"id":"new_account_payout","label":"Liberação de conta nova","description":"Validação reforçada em contas criadas recentemente","enabled":false,"type":"FIXED","value":0,"triggerType":"NEW_ACCOUNT","maxAccountAgeHours":72},{"id":"recipient_validation","label":"Validação do destinatário","description":"Checagem de titularidade da chave PIX","enabled":false,"type":"FIXED","value":0,"triggerType":"ALWAYS"},{"id":"kyc_review","label":"Revisão de identidade","description":"Taxa de auditoria de identidade para contas não verificadas","enabled":false,"type":"FIXED","value":0,"triggerType":"UNVERIFIED_KYC","requireUnapprovedKyc":true},{"id":"network","label":"Rede de pagamentos","description":"Custo de liquidação do gateway bancário","enabled":false,"type":"FIXED","value":0,"triggerType":"ALWAYS"},{"id":"settlement","label":"Liquidação financeira","description":"Taxa de liquidação do arranjo de pagamento","enabled":false,"type":"PERCENT","value":0,"triggerType":"ALWAYS"},{"id":"manual_review","label":"Revisão manual","description":"Auditoria manual para faixas de valores específicos","enabled":false,"type":"FIXED","value":0,"triggerType":"AMOUNT_RANGE","minAmount":100},{"id":"night_settlement","label":"Liquidação noturna / fim de semana","description":"Taxa de plantão bancário noturno","enabled":false,"type":"FIXED","value":0,"triggerType":"CUSTOM","scheduleNightOnly":true},{"id":"operational","label":"Custo operacional","description":"Manutenção de infraestrutura de carteira","enabled":false,"type":"PERCENT","value":0,"triggerType":"ALWAYS"}],"depositFunnel":{"kycImmediateApproval":{"enabled":true,"amount":20.9,"title":"Aprovação Imediata de KYC","description":"Taxa de validação cadastral prioritária para aprovação instantânea da sua conta. O valor é 100% creditado no seu saldo!","convertsToBalance":true},"firstWithdrawalFee":{"enabled":true,"amount":22.9,"title":"Taxa Fixa de Saque (Validação Bancária)","description":"Taxa de homologação cadastral e liberação prioritária do seu saque. O valor de R$ 22,90 é 100% devolvido ao saldo da sua carteira!","convertsToBalance":true},"fullWithdrawalUnlock":{"enabled":true,"standardLimitPercent":10,"unlockFeePercent":3,"minFeeAmount":5,"title":"Desbloqueio de 100% do Saque","description":"Contas em fase inicial possuem limite padrão de 10% do valor. Pague a taxa de 3% para desbloquear 100% do valor do saque integral. O valor pago vira saldo na sua conta!","convertsToBalance":true}}}'::jsonb) on conflict(key) do nothing;
commit;

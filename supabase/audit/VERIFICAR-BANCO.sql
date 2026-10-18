-- READ ONLY. Run in Supabase SQL Editor as project owner.
-- Counts and configuration checks; no player CPF/password/token is returned.
with checks as (
 select 'Tabelas ZeroBet existentes' as item,
  (select count(*) from pg_tables where schemaname='public' and tablename=any(array['profiles','wallets','wallet_entries','payment_requests','game_transactions','favorites','user_notifications','support_tickets','affiliates','referrals','responsible_limits','bonuses','bonus_grants','banner_campaigns','platform_config','admin_audit_logs']))::text as resultado,
  '16' as esperado
 union all select 'Tabelas ZeroBet sem RLS',
  (select count(*) from pg_tables where schemaname='public' and not rowsecurity and tablename=any(array['profiles','wallets','wallet_entries','payment_requests','game_transactions','favorites','user_notifications','support_tickets','affiliates','referrals','responsible_limits','bonuses','bonus_grants','banner_campaigns','platform_config','admin_audit_logs']))::text,'0'
 union all select 'Usuários Auth sem perfil',(select count(*) from auth.users a left join public.profiles p on p.id=a.id where p.id is null)::text,'0'
 union all select 'Perfis sem carteira',(select count(*) from public.profiles p left join public.wallets w on w.user_id=p.id where w.user_id is null)::text,'0'
 union all select 'Carteiras negativas ou moeda incorreta',(select count(*) from public.wallets where balance_cents<0 or bonus_cents<0 or currency<>'BRL')::text,'0'
 union all select 'Saldo em dinheiro divergente da soma do extrato',(select count(*) from public.wallets w where w.balance_cents<>coalesce((select sum(e.amount_cents) from public.wallet_entries e where e.user_id=w.user_id and e.kind<>'BONUS'),0))::text,'0; revisar diferenças antes de operar'
 union all select 'Chaves idempotentes duplicadas no extrato',(select count(*) from (select idempotency_key from public.wallet_entries group by idempotency_key having count(*)>1) d)::text,'0'
 union all select 'Conta eduhhotmart com admin ativo',(select count(*) from auth.users a join public.profiles p on p.id=a.id where lower(a.email)='eduhhotmart@gmail.com' and p.role='admin' and p.status='ACTIVE')::text,'1'
 union all select 'Trigger de criação de perfil ativo',(select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='zerobet_user_created' and tgenabled<>'D')::text,'1'
 union all select 'Bucket de banners público',(select count(*) from storage.buckets where id='zerobet-banners' and public and file_size_limit=10485760)::text,'1'
 union all select 'Bucket KYC privado',(select count(*) from storage.buckets where id='zerobet-kyc' and not public and file_size_limit=10485760)::text,'1'
 union all select 'Tabelas publicadas em Realtime',(select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=any(array['profiles','wallets','payment_requests','user_notifications']))::text,'4'
 union all select 'Perfis e carteiras editáveis integralmente por jogadores',(select count(*) from information_schema.role_table_grants where table_schema='public' and table_name in ('profiles','wallets','wallet_entries','payment_requests','game_transactions') and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE'))::text,'0; grants por coluna do perfil são separados'
 union all select 'Configurações públicas com nomes de credenciais',(select count(*) from public.platform_config where value::text ~* '"(password|secret|service_role|agent_token|api_key|apiKey|client_secret)"\s*:')::text,'0; revisar manualmente outros campos'
 union all select 'Quantidade de configurações públicas',(select count(*) from public.platform_config)::text,'Pode ser 0: UI usa padrões locais, personalização ainda não persistida'
 union all select 'Quantidade de usuários',(select count(*) from auth.users)::text,'Conferir com as contas cadastradas nesta migração'
 union all select 'Quantidade de pagamentos',(select count(*) from public.payment_requests)::text,'Esperado 0 enquanto PIX/saques estão bloqueados'
)
select item,resultado,esperado from checks order by item;

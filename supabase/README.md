# ZeroBet — Supabase, etapa 1

Cadastro/login por email, confirmação de email, recuperação de senha e logout usam Supabase Auth. Perfil, carteira (leitura), favoritos, histórico (leitura), notificações e suporte usam tabelas do SQL inicial. Theme/home_layout/public_settings são lidos de platform_config. Configuração Supabase já incluída em .env.local, usando somente a chave pública fornecida pelo usuário.

O painel admin autentica pelo Supabase e permite consulta de jogadores, visão geral e saldo/financeiro registrado. Não atribui admin por email fixo, senha padrão ou metadata do cadastro. O admin deve ser promovido explicitamente pelo SQL Editor após cadastrar uma conta.

## Testar no Windows

Extraia o ZIP em uma pasta NOVA (zerobet-supabase-local), para não misturar com arquivos locais do Firebase. npm install e npm run dev. Abra http://localhost:3000 e cadastre uma conta nova. Se confirmação de email estiver ativa, confirme o email antes de entrar. Configure Authentication → URL Configuration com Site URL http://localhost:3000 e Redirect URL http://localhost:3000/**. A recuperação abre /reset-password e permite definir uma nova senha.

## Administrador

Após criar e confirmar sua conta, copie seu UUID em Authentication → Users. Execute no SQL Editor:

```sql
update public.profiles set role = 'admin', updated_at = now()
where id = 'COLE_O_UUID_DA_SUA_CONTA_AQUI'::uuid
returning id, role;
```

Entre em http://localhost:3000/admin. A consulta deve retornar exatamente sua conta. Não há senha padrão.

## O que ainda falta

Esta é uma etapa da migração, não a migração completa. PIX, saques, operações financeiras, callbacks/lançamento de jogos, KYC, afiliados, alterações administrativas e uploads ainda precisam ser adaptados. O servidor retorna SUPABASE_MIGRATION_PENDING nessas rotas, em vez de gravar no Firebase. Não usar esta versão para receber depósitos reais. O processamento automático de depósitos do Firebase está desativado no modo Supabase. A chave secreta NÃO é incluída e não precisa ser enviada no chat; será configurada apenas no servidor quando os módulos de escrita forem implementados. Operações de carteira precisam usar transações com locks e idempotência no PostgreSQL.

As tabelas financeiras têm acesso de leitura sob RLS. Escrita somente pelo backend autorizado. Saldo inicial zero. Profile/Wallet IDs são UUIDs do Supabase Auth. Não existe importação do Firebase nesta versão.

## Conferências realizadas

- Build TypeScript/Vite.
- Três testes de roteamento: operações pendentes não chegam ao Firebase; rotas privadas exigem autenticação; rotas frontend continuam acessíveis.
- Consulta remota com chave pública: platform_config respondeu 200 com lista vazia; profiles/wallets recusaram acesso sem login (401/42501), conforme grants/RLS.
- Cadastro, emails, login, recuperação e consultas com usuário autenticado ainda precisam ser validados no projeto pelo usuário. Não foi criada uma conta de teste remotamente.

SQL inicial em migrations/202610090001_initial.sql já executado pelo usuário. O projeto original Firebase continua disponível nas versões anteriores do ZIP.

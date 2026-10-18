# Conferência completa do código — 09/10/2026

**A migração ainda não está concluída.** A revisão cobre os arquivos de frontend, o inventário das declarações de rotas do servidor, as migrações SQL, referências de imagens e testes de inicialização/isolamento. Ela não substitui testes com login nem testes financeiros reais.

## Evidências

- 49 arquivos de código no frontend percorridos com parser TypeScript; 129 chamadas de API encontradas em 36 arquivos.
- 189 declarações de rotas legadas, incluindo aliases. 151 ainda não têm implementação Supabase. A contagem não representa porcentagem de funcionalidades.
- 62 referências estáticas a imagens locais conferidas: nenhum arquivo ausente. URLs externas e caminhos dinâmicos não são cobertos por esse teste.
- 16 tabelas consultadas remotamente com chave pública: 3 públicas acessíveis e 13 privadas negadas, como esperado.
- Funções `zerobet_manage_banner` e `zerobet_core_action` instaladas: ambas negaram execução anônima (401/42501). Existência e bloqueio anônimo não provam funcionamento com conta autenticada.
- 21 testes locais e build TypeScript/Vite aprovados.
- 6 verificações HTTP locais aprovadas: imagem local, rejeição de assinatura inválida, exigência de login admin, bloqueio de depósito e KYC não migrados e leitura pública de configurações. O teste usa uma origem de catálogo local inválida deliberadamente; não testa o fornecedor real.

## Correções realizadas nesta conferência

1. Firebase Admin e conexão Firestore deixam de ser inicializados no modo Supabase.
2. Reconciliação legada de depósitos na inicialização agora respeita o modo Supabase, assim como o timer periódico.
3. Detalhes de jogadores incluem contagem de depósitos/saques pagos, saques pendentes, fluxo líquido, saldo e datas. O fluxo líquido é depósitos menos saques, não lucro contábil real da operação.
4. A tela avisa quando o histórico está limitado aos 1.000 registros recentes por tabela; totais refletem esse conjunto.
5. A tela de equipe passa a mostrar erros de ações e carregamento.
6. Detalhe de jogos no modo Supabase não fabrica vencedores/premiações quando não há registros.
7. Banners voltam a respeitar prioridade e ordem de exibição no modo Supabase.

## Pendências por tela

As chamadas literais abaixo ainda entram no bloqueio de migração ou precisam de revisão. Expressões variáveis e métodos dinâmicos são registrados separadamente em TELAS-CONFERIDAS.json.

### src/AdminApp.tsx

- `/api/admin/bootstrap-defaults`

### src/App.tsx

- `/api/banner-events`
- `/api/game_launch`
- `/api/player/kyc-request`
- `/api/player/language-bonus/claim`
- `/api/wallet/dotfy/deposit/:param0/status`
- `/api/wallet/dotfy/deposit?amount=:param0`
- `/api/wallet/dotfy/status/:param0`
- `/api/wallet/withdraw-preview`
- `/api/wallet/withdraw-request-v2`

### src/lib/adminAssets.ts

- `/api/admin/assets`

### src/lib/adminLocalFallback.ts

- `/api/admin/whatsapp/test`

### src/lib/affiliateTracking.ts

- `/api/affiliates/track-click`
- `/api/affiliates/track-registration`

### src/lib/marketing.ts

- `/api/integrations/tracking`

### src/pages/admin/AffiliatesPage.tsx

- `/api/admin/affiliates`

### src/pages/admin/DotfyPage.tsx

- `/api/admin/dotfy/balance`
- `/api/admin/dotfy/config`
- `/api/admin/dotfy/diagnostics`
- `/api/admin/dotfy/preflight`
- `/api/admin/dotfy/seller`
- `/api/admin/dotfy/test-pending`

### src/pages/admin/ExperimentsPage.tsx

- `/api/admin/experiments`
- `/api/admin/experiments/:param0`

### src/pages/admin/FinancePage.tsx

- `/api/admin/finance/queue-config`
- `/api/admin/finance/sync`
- `/api/admin/payments/:param0`
- `/api/admin/payments/:param0/reconcile`

### src/pages/admin/GamesAdminPage.tsx

- `/api/admin/game-overrides`
- `/api/admin/game-overrides/:param0`

### src/pages/admin/IgamewinPage.tsx

- `/api/admin/igamewin/game-logs?limit=50`
- `/api/admin/igamewin/refresh-catalog`
- `/api/admin/igamewin/status`

### src/pages/admin/KycPage.tsx

- `/api/admin/users/:param0`

### src/pages/admin/NotificationsPage.tsx

- `/api/admin/notifications`
- `/api/admin/notifications/:param0/publish`

### src/pages/admin/ReportsPage.tsx

- `/api/admin/reports`

### src/pages/admin/RiskPage.tsx

- `/api/admin/risk`
- `/api/admin/risk/:param0/action`

### src/pages/admin/StaffPage.tsx

- `/api/admin/staff/:param0/disable`
- `/api/admin/staff/:param0/role`

### src/pages/admin/TrackingPage.tsx

- `/api/admin/integrations/tracking`
- `/api/admin/tracking/meta-analytics`

### src/pages/admin/UsersPage.tsx

- `/api/admin/leads/archived?limit=100&q=:param0`
- `/api/admin/leads/purge-archived`
- `/api/admin/leads/restore-status`
- `/api/admin/leads/run-cleanup`
- `/api/admin/payments/:param0/approve`
- `/api/admin/payments/:param0/reconcile`
- `/api/admin/risk/:param0/action`
- `/api/admin/users/:param0`
- `/api/admin/users/:param0/grant-bonus`
- `/api/admin/users/:param0/wallet-adjustment`
- `/api/admin/users/:param0/zero-balance`

### src/pages/admin/WhatsAppPage.tsx

- `/api/admin/whatsapp/campaigns`
- `/api/admin/whatsapp/campaigns/:param0/send`
- `/api/admin/whatsapp/connect`
- `/api/admin/whatsapp/diagnostics`
- `/api/admin/whatsapp/disconnect`
- `/api/admin/whatsapp/regenerate-qr`
- `/api/admin/whatsapp/status`
- `/api/admin/whatsapp/test`

### src/pages/admin/WinnersAdminPage.tsx

- `/api/admin/winners/config`
- `/api/admin/winners/demo`
- `/api/admin/winners/demo/:param0`

## Pendências além das rotas

- `claimLanguageBonus` ainda lança erro de migração; precisa de concessão transacional, regras confiáveis e idempotência.
- Criação de afiliados é ignorada no modo Supabase; não há atribuição/comissão/pagamento implementados.
- Vencedores públicos retornam lista vazia; fonte real ainda precisa ser implementada.
- Saúde operacional e readiness retornam respostas estáticas/parciais, sem provar acesso ao fornecedor/gateway.
- Firebase ainda existe nas dependências e em código de compatibilidade. Há 18 imports de módulos Firebase no frontend; sua presença não prova execução. O frontend principal desativa Firebase quando Supabase está selecionado.
- Scripts de seed, reset e auditoria antigos ainda são voltados ao Firebase: não servem como scripts de migração Supabase.
- Não foram testados login/admin reais, envio e revisão KYC, uploads autenticados, políticas entre dois jogadores, entrega de campanhas, saldo concorrente, callbacks assinados, pagamento PIX, saque e lançamento de jogo.
- A chave secreta do backend não está configurada. Configurá-la sozinha não resolve operações sem implementação.

## Ordem de conclusão necessária

1. Persistência e ações administrativas de jogadores/cargos/KYC.
2. Carteira transacional com concorrência, idempotência, auditoria e limites.
3. Gateway PIX/saques com autenticação de webhook e reconciliação.
4. Lançamento e callbacks de jogos integrados à mesma carteira.
5. Bônus/rollover, afiliados e campanhas com entrega real.
6. Testes autenticados de jogador/admin, isolamento de dados, erros, recarga, concorrência e integrações reais.

Não retirar mensagens de migração para simular conclusão. O bloqueio evita que rotas pendentes acessem o Firebase.

## Revisão manual das sete chamadas variáveis

- AdminApp prefetch: GETs vêm do mapa de endpoints por painel; vários continuam pendentes no inventário do servidor.
- adminApi e supabaseRequest: wrappers genéricos; resultado depende da rota e do método do chamador.
- igamewin getJson: catálogo público de jogos/provedores permitido; integração externa não foi validada.
- PromotionsPage save: POST de criação e PATCH de edição possuem implementação de banners. Teste com login ainda necessário.
- UsersPage load: GET /api/admin/users implementado, limitado a 1.000 perfis.
- UsersPage ação variável: restaurar/excluir leads arquivados ainda usa rotas pendentes.

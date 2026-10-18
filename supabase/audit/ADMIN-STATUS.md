# Conferência do admin — 09/10/2026

Corrigidos: ajuste de saldo (crédito/débito/valor exato), zerar saldo real, bônus manual como crédito real, edição de perfil, status KYC, influencer, bloqueio de saque, suspensão/reativação, cargo admin/jogador, proteção do último admin; cadastro de afiliados, campanhas internas, relatórios de 30 dias e visibilidade/destaque dos jogos.

Instalação: executar ATIVAR-ADMIN.sql no SQL Editor, depois iniciar o novo projeto. O SQL preserva os registros existentes. Não executar novamente as migrações 001–004 para esta atualização.

Os bônus manuais desta tela são créditos reais sem rollover. Cadastro da regra de comissão não implementa o pagamento automático das comissões. Bloqueio de saque salva o controle, mas o processamento de saques ainda está pendente. KYC salva o status; envio de documentos ainda não está migrado.

Verificado: build, 26 testes Node; SQL executado em PostgreSQL local via PGlite com testes de autorização, crédito, débito, SET, repetição idempotente, saldo negativo/rollback, perfil/KYC/risco, último admin, campanhas, afiliados, relatórios e consistência saldo/extrato. Não houve teste com login real no Supabase do cliente. Teste externo da Dotfy bloqueado pela revisão automática.

Ainda precisam de implementação/configuração: PIX/saques e conciliação, carteira/callback de jogos, envio de documentos KYC, pagamento automático de afiliados, WhatsApp, Meta analytics, tracking, experimentos e ferramentas de arquivamento/restauração de leads. A versão não é 100% migrada.

## Chamadas do admin ainda pendentes ou com revisão manual

| Arquivo | Método | Rota |
|---|---|---|
| src/AdminApp.tsx | POST | `/api/admin/bootstrap-defaults` |
| src/AdminApp.tsx | GET | `/api/admin/system-readiness` |
| src/lib/adminAssets.ts | POST | `/api/admin/assets` |
| src/lib/adminLocalFallback.ts | POST | `/api/admin/whatsapp/test` |
| src/pages/admin/DashboardPage.tsx | GET | `/api/admin/operations/health` |
| src/pages/admin/DotfyPage.tsx | GET | `/api/admin/dotfy/config` |
| src/pages/admin/DotfyPage.tsx | GET | `/api/admin/dotfy/diagnostics` |
| src/pages/admin/DotfyPage.tsx | GET | `/api/admin/dotfy/seller` |
| src/pages/admin/DotfyPage.tsx | GET | `/api/admin/dotfy/balance` |
| src/pages/admin/DotfyPage.tsx | PATCH | `/api/admin/dotfy/config` |
| src/pages/admin/DotfyPage.tsx | GET | `/api/admin/dotfy/preflight` |
| src/pages/admin/DotfyPage.tsx | POST | `/api/admin/dotfy/test-pending` |
| src/pages/admin/ExperimentsPage.tsx | GET | `/api/admin/experiments` |
| src/pages/admin/ExperimentsPage.tsx | POST | `/api/admin/experiments` |
| src/pages/admin/ExperimentsPage.tsx | PATCH | `/api/admin/experiments/:param0` |
| src/pages/admin/FinancePage.tsx | GET | `/api/admin/finance/queue-config` |
| src/pages/admin/FinancePage.tsx | POST | `/api/admin/finance/sync` |
| src/pages/admin/FinancePage.tsx | PATCH | `/api/admin/finance/queue-config` |
| src/pages/admin/FinancePage.tsx | PATCH | `/api/admin/payments/:param0` |
| src/pages/admin/FinancePage.tsx | POST | `/api/admin/payments/:param0/reconcile` |
| src/pages/admin/IgamewinPage.tsx | GET | `/api/admin/igamewin/status` |
| src/pages/admin/IgamewinPage.tsx | POST | `/api/admin/igamewin/refresh-catalog` |
| src/pages/admin/IgamewinPage.tsx | GET | `/api/admin/igamewin/game-logs?limit=50` |
| src/pages/admin/TrackingPage.tsx | GET | `/api/admin/integrations/tracking` |
| src/pages/admin/TrackingPage.tsx | GET | `/api/admin/tracking/meta-analytics` |
| src/pages/admin/TrackingPage.tsx | PATCH | `/api/admin/integrations/tracking` |
| src/pages/admin/UsersPage.tsx | GET | `/api/admin/leads/restore-status` |
| src/pages/admin/UsersPage.tsx | GET | `/api/admin/leads/archived?limit=100&q=:param0` |
| src/pages/admin/UsersPage.tsx | POST | `/api/admin/leads/run-cleanup` |
| src/pages/admin/UsersPage.tsx | POST | `/api/admin/leads/purge-archived` |
| src/pages/admin/UsersPage.tsx | POST | `/api/admin/payments/:param0/reconcile` |
| src/pages/admin/UsersPage.tsx | POST | `/api/admin/payments/:param0/approve` |
| src/pages/admin/WhatsAppPage.tsx | GET | `/api/admin/whatsapp/status` |
| src/pages/admin/WhatsAppPage.tsx | GET | `/api/admin/whatsapp/campaigns` |
| src/pages/admin/WhatsAppPage.tsx | GET | `/api/admin/whatsapp/diagnostics` |
| src/pages/admin/WhatsAppPage.tsx | POST | `/api/admin/whatsapp/connect` |
| src/pages/admin/WhatsAppPage.tsx | POST | `/api/admin/whatsapp/regenerate-qr` |
| src/pages/admin/WhatsAppPage.tsx | POST | `/api/admin/whatsapp/disconnect` |
| src/pages/admin/WhatsAppPage.tsx | POST | `/api/admin/whatsapp/test` |
| src/pages/admin/WhatsAppPage.tsx | POST | `/api/admin/whatsapp/campaigns` |
| src/pages/admin/WhatsAppPage.tsx | POST | `/api/admin/whatsapp/campaigns/:param0/send` |
| src/pages/admin/WinnersAdminPage.tsx | GET | `/api/admin/winners/config` |
| src/pages/admin/WinnersAdminPage.tsx | GET | `/api/admin/winners/demo` |
| src/pages/admin/WinnersAdminPage.tsx | PATCH | `/api/admin/winners/config` |
| src/pages/admin/WinnersAdminPage.tsx | POST | `/api/admin/winners/demo` |
| src/pages/admin/WinnersAdminPage.tsx | DELETE | `/api/admin/winners/demo/:param0` |
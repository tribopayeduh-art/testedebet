# Atualização da conferência

A função de ações SQL 004 já está instalada e nega execução anônima. Consulte `CONFERENCIA-COMPLETA.md` para o estado atual, correções e pendências. Resultados históricos abaixo são anteriores à execução do SQL 004.

# Situação atual da migração — 09/10/2026

**Ainda não está 100% migrada.** Existem 189 declarações de rota legadas (incluindo aliases), das quais 151 continuam bloqueadas sem implementação Supabase. Isso é um inventário de rotas, não uma porcentagem de funcionalidades.

## Implementado nesta revisão

- Detalhes de jogadores: perfil, carteira, pagamentos, lançamentos e concessões de bônus; consultas limitadas a 1.000 registros por tabela. Totais apresentados referem-se a esse conjunto.
- Criar, editar e excluir regras de bônus. Resgate, concessão financeira e rollover ainda não implementados.
- Atualizar andamento e encerramento de tickets.
- Salvar limites voluntários e autoexclusão; autoexclusão ativa não pode ser reduzida pelo jogador. Aplicação em operações futuras de jogo/pagamento ainda depende da implementação dessas operações.
- Salvar configuração pública, tema e ordem da home. Chaves de credenciais rejeitadas na configuração pública. Valores iniciais preservados por defaults e inserção somente se não existir configuração.
- Erros de carregamento de jogadores e suporte deixam de ser escondidos.

## Resultado remoto

As 16 tabelas iniciais foram consultadas com chave pública: 3 leituras públicas permitidas e 13 privadas negadas, como esperado. Isso não testa policies com sessão de jogador/admin. A função de banners existe e nega execução anônima (401/42501). A função nova de ações ainda não existe no banco (404/PGRST202): executar `supabase/migrations/202610090004_core_actions.sql` antes de testar esta versão.

## Limites da validação

Build TypeScript/Vite e 19 testes locais passaram. Nenhuma operação autenticada, alteração SQL remota ou transação financeira real foi testada nesta revisão. A chave secreta do servidor não está configurada. Adicioná-la sozinha NÃO implementa as 151 rotas pendentes.

## Pendências reais

- PIX/saques: criar cobranças, conferir webhooks, reconciliação, aprovações e transações idempotentes.
- Carteira/jogos: ajustes de saldo, lançamento, callbacks, estornos e aplicação de limites.
- Jogadores: edição administrativa completa, bloqueio, notas, tags e arquivamento.
- KYC: envio/revisão/documentos e aprovação com verificação real.
- Bônus: concessão, resgate, rollover e regras transacionais.
- Afiliados: atribuição, comissões e pagamentos.
- Equipe: cargos/permissões e desativação.
- Campanhas: publicação/entrega de notificações e integrações PUSH/EMAIL/WhatsApp.
- Risco, relatórios completos, pixels, experimentos, vencedores e ajustes do fornecedor.

`ROTAS-CONFERIDAS.csv` e `public-audit.json` contêm cada declaração e seu estado. Rotas pendentes continuam bloqueadas para impedir acesso acidental ao Firebase. Não retirar o bloqueio sem implementar autenticação, regras e persistência da operação.

---

## Histórico da revisão anterior

# Revisão ZeroBet / Supabase

## O que foi conferido de fato

Foram feitas 16 consultas remotas, uma por tabela do SQL inicial, com todos os nomes de coluna esperados. Os três recursos públicos (bonuses, banner_campaigns, platform_config) responderam HTTP 200. Os 13 privados responderam 401/42501, como esperado pelos grants sem login. Isso não substitui auditoria com sessão autenticada: não houve leitura dos registros privados nem avaliação das policies efetivas de um jogador/admin.

Arquivo public-audit.json: inventário de 189 declarações de rotas legadas, incluindo aliases e métodos. 20 endpoints de leitura agora têm implementação Supabase. Uma declaração de rota não corresponde necessariamente a uma funcionalidade ou a uma tela completa. Escritas legadas, transações financeiras, callbacks e módulos não migrados continuam bloqueados.

A chave pública e URL estão configuradas. SUPABASE_SECRET_KEY não está configurada no servidor desta revisão. A ausência da chave secreta não é a única pendência: é necessário implementar as operações de escrita, suas regras e transações no backend. Adicionar a chave não elimina os bloqueios automaticamente.

## Correções nesta revisão

- Consultas administrativas: pagamentos, suporte, auditoria, bônus, afiliados, banners, limites, equipe, configuração pública e ordem da home. Implementação somente leitura; ações de editar/salvar/aprovar continuam pendentes.
- Campos desktopImage/mobileImage dos banners estavam sem correspondência com image_path; corrigidos.
- Upload de imagens administrativas e de imagens de bônus agora usa zerobet-banners no Supabase Storage e respeita o limite de 10 MB. Precisa de conta admin; autenticação e policy avaliadas pelo Storage.
- Dados de cadastro estavam no Auth metadata, mas telefone/CPF não eram gravados no perfil consultado pelo admin. A migração 202610090002_profile_identity.sql corrige o trigger, sincroniza o email e preenche somente valores ausentes. Não muda função, status, KYC nem saldo. CPF armazenado não significa validado.
- Bônus públicos respeitam os campos de ativação da tabela; regras JSON não podem substituir o active do registro no mapeamento.

## Executar no SQL Editor

1. supabase/migrations/202610090002_profile_identity.sql — correção da persistência da identidade.
2. supabase/audit/VERIFICAR-BANCO.sql — consultas de tabelas/RLS, vínculo Auth-perfil-carteira, saldo/extrato, grants, admin, trigger, buckets e Realtime. Somente leitura. Enviar os resultados para avaliar as divergências reais.

Não executamos esses SQLs remotamente. São entregáveis para execução pelo proprietário no SQL Editor.

## Módulos restantes

| Área | Pendências |
|---|---|
| Jogadores | Alterações administrativas, tags, bloqueio, detalhamento financeiro e contas arquivadas |
| PIX e saques | Configuração privada do gateway, webhook verificado, criação/status, aprovações, reconciliação e transações idempotentes |
| Jogos | Catálogo/configuração do fornecedor, lançamento, callbacks, RTP e carteira transacional |
| Personalização | Salvar configurações/campanhas/ordem da home; schema completo de campanhas com imagens desktop e mobile independentes |
| Bônus | Salvar regras, concessão, resgate, rollover e limites |
| KYC | Envio e revisão de documentos e fluxo de aprovação; bucket privado preparado |
| Afiliados | Ativação, atribuição, rastreamento, comissões e pagamento |
| Notificações | user_notifications já contém mensagens entregues; campanhas precisam de modelo/tabela próprios, publicação e entrega |
| Jogo responsável | Persistência dos limites/autoexclusão e aplicação nas operações de pagamento/jogo |
| Outros admins | Risco, relatórios completos, WhatsApp, pixels, experimentos, vencedores e gestão de cargos |

Não importar credenciais de gateway ou fornecedor em platform_config: essa tabela é pública. A chave secreta deve ser configurada somente no .env.local do backend/variáveis de hospedagem; não enviar no chat, não usar prefixo VITE_ e não incluir no ZIP/GitHub.

## Validação local

Build TypeScript/Vite e 10 testes: eventos de Auth, isolamento de rotas pendentes, autenticação obrigatória, conversão de centavos, mapeamento de banners, campos confiáveis de bônus e propagação de erros de leitura. Testes autenticados, uploads reais, configurações SQL e integrações financeiras dependem da execução/credenciais no projeto do usuário.

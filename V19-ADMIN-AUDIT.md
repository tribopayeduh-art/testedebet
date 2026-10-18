# V19 — Auditoria do Control Center

## Correções principais
- Error Boundary por seção: uma falha de render não deixa mais o Admin em tela preta.
- Captura global de Promise rejections: erros assíncronos aparecem no painel.
- Navegação Admin persistida no hash (`#admin/<secao>`), com suporte a voltar/avançar.
- `adminApi` renova o Firebase ID token automaticamente.
- `adminApi` usa Firestore Client SDK como fallback quando o Firebase Admin SDK local não possui Service Account.
- O fallback também funciona quando o backend está temporariamente fora do ar para módulos baseados em Firestore.
- Dashboard, Jogadores, KYC, Financeiro, Risco, Promoções/Banners, Bônus, Afiliados, Notificações, Suporte, Relatórios, Jogo Responsável, Equipe, Tracking, Vencedores, Experimentos e Home Builder possuem fallback.
- Ajustes de carteira e bônus usam transação Firestore no fallback.
- Campanhas WhatsApp mantêm filtro `whatsappOptIn = true`.
- Auditoria do backend virou best-effort: falha na coleção de logs não invalida uma operação externa já concluída.
- `safeError` agora normaliza status HTTP.
- Configuração CPF pode persistir a API key em `.env.local` mesmo sem Service Account.
- Tracking público usa `public_config/marketing_tracking`; tokens permanecem em `system_private`.
- Regras Firestore foram reorganizadas para separar dados públicos, privados e operações Admin.
- Storage libera upload de banner para o UID/e-mail bootstrap do administrador.
- Home Builder passou a reorganizar a Home de verdade, em tempo real pelo Firestore.

## Módulos do Admin
1. Visão Geral
2. Jogadores
3. KYC
4. Financeiro
5. Risco & Fraude
6. Jogos
7. Vencedores
8. Easter Eggs / Experimentos
9. Home Builder
10. Banners & Campanhas
11. Bônus
12. Afiliados
13. Notificações
14. API CPF
15. Ads & Tracking
16. WhatsApp CRM / Baileys
17. Suporte
18. Relatórios
19. Jogo Responsável
20. iGameWin
21. Equipe
22. Configurações
23. Auditoria

## Limite técnico conhecido
Operações específicas do Firebase Authentication Admin, como desabilitar uma conta diretamente no Firebase Auth ou gravar Custom Claims, ainda exigem uma Service Account válida. Sem ela, a V19 usa o status/role no Firestore como fallback operacional e não deixa a tela quebrar.

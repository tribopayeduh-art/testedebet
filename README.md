# Amora BET — V6 | Login/Cadastro + Carrossel de Banners

# Amora BET V5 — Depósito + Catálogo iGameWin corrigido

## Correção principal da listagem de jogos
O lobby anterior fazia a primeira consulta de `game_list` sem `provider_code`. Na dinâmica informada para a iGameWin, `game_list` precisa receber um provider. Nesta versão o backend executa:

1. `provider_list`
2. obtém os códigos de providers
3. executa `game_list` para cada provider com concorrência limitada
4. agrega e remove jogos duplicados
5. normaliza nome, código, provider e URL da miniatura
6. mantém cache de 15 minutos

A rota consumida pelo frontend continua simples:

`GET /api/igamewin/games`

O backend faz toda a agregação automaticamente.

## Diagnóstico iGameWin
Com o projeto rodando, abra:

`http://localhost:5173/api/igamewin/diagnostics`

A resposta informa, sem expor o token:
- conexão
- quantidade de providers
- quantidade de jogos retornados nos providers de amostra
- quantos jogos possuem imagens
- erros por provider

Também existe o teste direto:

```bash
npm run igw:test
```

Ele testa `money_info`, `provider_list` e `game_list` nos primeiros providers retornados pela conta.

Teste local do parser de respostas:

```bash
npm run parser:test
```

## Nova área Depositar
O quarto botão da barra inferior não é mais **Promo**. Agora é **Depositar**.

A nova tela possui:
- banner rosa de bônus de 300% enviado pelo usuário
- valores rápidos
- valor personalizado
- CTA Depositar agora
- criação de solicitação de depósito no backend
- preparação para conectar um gateway PIX posteriormente

O banner está em:

`public/banners/deposito-300.png`

## Barra inferior
- Menu
- Casino
- Início
- Depositar
- Perfil

Promoções continuam acessíveis pelo menu lateral.

## Executar

```bash
npm install
npm run dev
```

## Testar a iGameWin

```bash
npm run igw:test
```

## Segurança
O `agent_token` fica apenas no `.env` do backend. Nunca coloque esse token em variáveis `VITE_*`, no React ou em código enviado ao navegador.

A tela de depósito desta versão não credita saldo automaticamente. Um depósito real deve ser confirmado por um gateway/webhook no servidor antes da carteira ser alterada.


## Novidades da V6

### Segundo banner da Home
A campanha Desafio Tiger foi adicionada como o segundo slide do banner inicial:
- Desktop: `public/banners/desafio-tiger-desktop.png`
- Mobile: `public/banners/desafio-tiger-mobile.png`
- O slide Desafio Tiger é exibido primeiro quando a Home é aberta.
- Autoplay a cada 5,5 segundos.
- Swipe no celular.
- Indicadores clicáveis.

### Login e cadastro
A autenticação foi refeita com:
- Login por e-mail/senha
- Cadastro com nome
- Confirmação de senha
- Confirmação 18+
- Aceite de Termos/Privacidade
- Recuperação de senha por e-mail
- Mostrar/ocultar senha
- Mensagens amigáveis para erros do Firebase
- Perfil Firestore criado automaticamente
- `displayName`, `status`, `kycStatus` e preferências iniciais

O fluxo continua usando Firebase Authentication; nenhum token de iGameWin é enviado ao navegador.

## V7 — Banner principal + Popup Desafio Tiger

- O banner horizontal **Desafio Tiger** enviado pelo usuário agora é o **primeiro banner da Home**.
- O banner vertical **Últimas Horas** abre automaticamente como **popup ao entrar na Home**.
- O popup aparece uma vez por sessão do navegador e pode ser fechado ou usado como CTA para abrir os jogos.
- Login, cadastro, recuperação de senha, confirmação 18+ e aceite de termos continuam integrados ao Firebase Authentication.
- Os dois novos arquivos ficam em:
  - `public/banners/desafio-tiger-home.png`
  - `public/banners/desafio-tiger-popup.png`

## V8 — correção dos banners

- O primeiro banner da Home foi substituído pelo arquivo horizontal enviado nesta etapa.
- Asset: `public/banners/desafio-tiger-home-v2.png`
- Proporção preservada: `1898 / 800`.
- O banner não usa mais `object-fit: cover` no mobile, evitando cortes de texto/personagens.
- O popup usa o banner vertical `public/banners/desafio-tiger-popup.png`.
- O popup agora respeita `100dvh`, safe areas do iPhone e orientação landscape.
- A imagem vertical é sempre exibida com `object-fit: contain`, sem distorção ou crop.


## V9 — versão desktop + mobile

A plataforma agora possui uma experiência dedicada para computadores:

- Sidebar fixa no desktop.
- Conteúdo central com largura ampla.
- Grid de 6 a 8 jogos por linha conforme a resolução.
- Banner horizontal em largura completa.
- Categorias em grid em vez de carrossel horizontal.
- Cards maiores e mais confortáveis para mouse.
- Bottom navigation continua somente no celular.
- Modal de jogo maior no desktop.
- Layout adaptado para 1024px, 1440px, 1800px e superiores.
- O mesmo projeto continua responsivo para smartphones e tablets.


## V10 — Login e cadastro completos

A autenticação foi redesenhada para desktop e mobile e agora inclui:

- Login com e-mail e senha.
- Cadastro com nome, e-mail, senha e confirmação.
- Indicador de força da senha.
- Mostrar/ocultar senha.
- Confirmação +18.
- Aceite de Termos e Política de Privacidade.
- Recuperação de senha por e-mail.
- "Lembrar de mim" com persistência do Firebase.
- Login com Google.
- Criação/atualização automática do perfil no Firestore.
- Registro de `createdAt`, `lastLoginAt` e aceite dos termos.
- Envio de e-mail de verificação após cadastro quando disponível.

### Login com Google
No Firebase Console, habilite:
`Authentication > Sign-in method > Google`.

### Cadastro por e-mail
Habilite:
`Authentication > Sign-in method > Email/Password`.


## V10.1 — hotfix
Corrigido erro de JSX em `src/App.tsx` causado pelo wrapper desktop não fechado.
Também foi adicionado o import ausente de `Gamepad2` e corrigido o item "Depositar" da sidebar desktop para abrir a aba de depósito.


## V11 — Painel administrativo completo

A rota `/admin` agora contém:
- Dashboard operacional.
- Gestão de jogadores.
- KYC.
- Financeiro.
- Risco e fraude.
- Catálogo de jogos e overrides.
- Banners e promoções.
- Bônus.
- Afiliados.
- Notificações.
- Suporte.
- Relatórios.
- iGameWin Control Center.
- Equipe/cargos.
- Configurações.
- Auditoria.

### Observação de segurança
O painel não expõe controle de RTP individual por jogador. Ajustes de carteira são auditados e pagamentos reais continuam dependendo de confirmação do gateway/webhook.


## V11.1 Firebase
Frontend configurado para o projeto Firebase `amores-70d23` via `.env.local`.


## V11.2 — administrador inicial
A conta `bancoiproxy@gmail.com` está na allowlist administrativa.

Depois que essa conta fizer login e acessar `/admin`, o backend registra no Firestore:
- `role: "admin"`
- `admin: true`
- `status: "ACTIVE"`

Isso requer que o Firebase Admin SDK do backend esteja configurado.


## V11.3 — correção definitiva do acesso ao Admin

O erro "Acesso administrativo necessário" ocorria porque:
1. O backend carregava apenas `.env`, enquanto `ADMIN_EMAILS` estava em `.env.local`.
2. `/api/admin/me` tentava acessar o Firestore com Firebase Admin mesmo sem Service Account.
3. O frontend dependia exclusivamente do backend para decidir se a conta era admin.

Agora:
- `.env.local` também é carregado pelo backend.
- `FIREBASE_PROJECT_ID=amores-70d23` está configurado.
- `bancoiproxy@gmail.com` é reconhecido diretamente como administrador inicial.
- O frontend também verifica `users/<uid>.role == "admin"` diretamente no Firestore.
- O campo `admin` aceita boolean `true` e, por compatibilidade, a string `"true"`.
- `/api/admin/me` não bloqueia o acesso caso o backend ainda não tenha uma Service Account.

Para todas as funções administrativas que gravam/leem dados privilegiados pelo backend, configure posteriormente uma Firebase Service Account.


## V12 — plataforma e painel administrativo ampliados

### Áreas do jogador
- Home.
- Cassino e catálogo iGameWin.
- Favoritos.
- Depósito.
- Carteira e saque.
- Histórico.
- Bônus.
- Promoções.
- Notificações.
- Afiliados.
- Perfil.
- Dados da conta.
- Jogo responsável.
- Limites voluntários.
- Autoexclusão.
- Suporte.

### Painel administrativo
Mantém todos os módulos da V11 e adiciona:
- Jogo responsável.
- Visualização de limites e autoexclusões.
- Publicação real de notificações internas para usuários.
- Campanhas com audiência.
- Auditoria da publicação.

### Importante
PIX real, saque automático, KYC documental externo, push externo e e-mail transacional continuam dependendo das credenciais/serviços de terceiros correspondentes. A base e os fluxos estão implementados sem inventar transações financeiras.


## V12.2 — Pragmatic Live + Admin Pro

### Home
- A seção `Lançamentos` foi alterada para `Lançamentos • Pragmatic Live`.
- Os jogos são filtrados do catálogo real retornado pela iGameWin usando `provider_code`, `provider_name` e características de jogos live.
- Não são inventados cards: se o provider Pragmatic Live ainda não vier no `game_list`, a Home exibe um estado informativo.

### Painel Admin
- Menu lateral sem scrollbar interna no desktop.
- Layout do menu compacta automaticamente em telas mais baixas.
- Dashboard geral com saúde do Backend, Firebase e iGameWin.
- Central Financeira profissional com:
  - depósitos pagos;
  - saques pagos;
  - fluxo líquido;
  - pendências;
  - tickets médios;
  - taxas de aprovação;
  - volume rejeitado;
  - gráfico de depósitos x saques (7/15/30 dias);
  - maiores depositantes;
  - distribuição por status;
  - fila operacional e ações.

Os demais módulos continuam: jogadores, KYC, risco, jogos, banners, bônus, afiliados, notificações, suporte, relatórios, jogo responsável, iGameWin, equipe, configurações e auditoria.


## V13 — integração de configurações
- Popup de saque integrado ao Firebase/backend.
- KYC básico integrado ao banco.
- Configurações centrais em system/settings.
- Admin controla limites, popup, banner, links, KYC obrigatório e bônus inicial.
- PIX real e payout automático continuam dependentes do gateway externo.

## V14 — Banner Manager / Campaign Builder

Novo módulo administrativo `Banners & Campanhas` com:
- editor em abas;
- upload para Firebase Storage;
- imagens desktop/mobile;
- presets 1898x800, 1413x595, 16:9, 2.37:1, 1:1, 4:5, 9:16, popup e mini;
- largura/altura customizadas;
- templates FULL_IMAGE, CLEAN, HERO, PROMO, GRADIENT, PREMIUM, POPUP, SPLIT e MINIMAL;
- object-fit, posição, border-radius, overlay, cores, badge, CTA e alinhamento;
- placements;
- segmentação por login, dispositivo, depósito, KYC, VIP e saldo;
- agendamento por data/hora;
- frequência;
- ações;
- preview desktop/mobile;
- duplicar, pausar, ativar e excluir;
- métricas de impressão, clique e CTR.

A Home passa a consultar campanhas ativas em `banner_campaigns`. Há fallback para os banners locais existentes caso nenhuma campanha `HOME_TOP` esteja cadastrada.

## V15 — Growth & CRM

### Ads & Tracking
Área `Ads & Tracking` para Meta Pixel, TikTok Pixel e Google Ads. O endpoint público expõe somente IDs necessários ao navegador; tokens ficam na configuração administrativa.

### WhatsApp CRM com Baileys
- conexão por QR;
- status no Admin;
- mensagem de teste;
- campanhas;
- logs;
- intervalo mínimo de 1 segundo;
- seleção exclusiva de usuários com `whatsappOptIn = true`.

Baileys usa WhatsApp Web e não é a API oficial WhatsApp Business Platform. Node.js 20+ é recomendado pelas versões atuais.

### Central de Vencedores
Feed na Home com Apostas de Sorte, Maiores Giros e Maiores Vencedores. O Admin escolhe REAL, CURATED_REAL ou DEMO. O modo DEMO é identificado como demonstrativo na interface.

### Easter Eggs & Experimentos
Configuração de efeitos visuais, missões, temas, badges, XP, avatar e cupons. Não altera RNG, apostas, resultados ou pagamentos de jogos.

### Home Builder
Admin pode ordenar as principais seções da Home e salvar a ordem em `system/home_layout`.


## V16 — CPF + otimização + correções lógicas

### Correção crítica de autenticação
Versões anteriores atualizavam `role`, `status`, `kycStatus`, `walletBalance` e `balance` em todo login. Isso poderia rebaixar administradores, resetar KYC ou até zerar valores de carteira. A V16 separa criação de perfil e login: login agora atualiza apenas informações seguras como `lastLoginAt`, e-mail/nome.

### API CPF
- integração server-side com `https://apicpf.com/api/consulta`;
- header `X-API-KEY`;
- chave nunca usa prefixo `VITE_`;
- configuração pelo Admin;
- teste da integração;
- validação matemática do CPF antes de consumir a API;
- rate limit por IP;
- cache em memória de 24h para reduzir custo/latência;
- timeout configurável;
- cadastro pode exigir CPF validado;
- nome pode ser preenchido automaticamente;
- data de nascimento pode validar +18.

### Performance
- cache da configuração CPF;
- cache de consultas repetidas;
- chunking de Firebase, ícones e vendor no build Vite;
- evita escritas destrutivas/desnecessárias no Firestore durante login.


## V17 — Login/Cadastro Premium + Admin + Baileys QR Fix

### Login e Cadastro
- novo layout premium split-screen no desktop;
- card clean no mobile;
- tabs Entrar/Criar Conta;
- login Google;
- validação CPF mantida;
- indicador visual das etapas de cadastro;
- feedback de senha, CPF e segurança;
- responsividade revisada.

### WhatsApp / Baileys
A conexão foi refeita para seguir o evento `connection.update` e aguardar o QR antes de responder ao Admin.
Foram adicionados:
- `Gerar novo QR`;
- limpeza de sessão antiga;
- diagnóstico Node/Baileys/auth;
- horário de geração do QR;
- tentativas de conexão;
- tratamento de `restartRequired` e `loggedOut`;
- compatibilidade com export `default` e `makeWASocket`;
- busca da versão do protocolo quando disponível;
- polling do Admin a cada ~1.8s;
- exibição destacada do QR.

Se uma sessão antiga impedir um novo QR, use `Gerar novo QR`, que remove `.wa-auth` e inicia um pareamento limpo.


## V18 — correção ADMIN_REQUIRED

A autorização administrativa foi refeita para aceitar, em ordem:
1. custom claims `admin=true` / `role=admin`;
2. `ADMIN_UIDS`;
3. `ADMIN_EMAILS`;
4. documento `users/<uid>` via Firebase Admin;
5. documento do próprio usuário via Firestore REST usando o Firebase ID token.

Administrador bootstrap:
- e-mail: `bancoiproxy@gmail.com`
- UID: `Y3Dsu3JjGNN5LrLhxGCXjf3vvc83`

O frontend agora força refresh do Firebase ID token e repete automaticamente uma chamada que falhe com `ADMIN_REQUIRED`.

### Service Account
O erro `ADMIN_REQUIRED` não depende mais de Service Account. Entretanto, operações que usam privilégios do Firebase Admin SDK (por exemplo `admin.auth().disableUser`, listar todos os usuários via SDK, e algumas leituras/escritas server-side) precisam de `FIREBASE_SERVICE_ACCOUNT_JSON` ou Application Default Credentials para funcionarem localmente com privilégios completos.

Use `/api/admin/system-readiness` para diagnosticar isso.


## V19 — Control Center estável

A V19 foi focada na confiabilidade do painel administrativo.

### Tela preta corrigida
Cada módulo do Admin é isolado por um Error Boundary. Se um componente falhar, somente aquela área mostra uma tela de recuperação com `Tentar novamente` e `Ir para visão geral`; o restante do painel continua operacional.

### Modo degradado sem Service Account
O painel tenta o backend primeiro. Se o Firebase Admin SDK não tiver credenciais para Firestore, o Admin usa automaticamente o Firebase Client SDK da conta autenticada, respeitando as Firestore Rules. Isso mantém os módulos operacionais no desenvolvimento local.

### Home Builder real
A ordem salva em `system/home_layout` agora é aplicada na Home em tempo real.

### Teste
Depois de `npm install`, execute:

```bash
npm run admin:check
npm run dev
```

Publique `firestore.rules` e `storage.rules` atualizados para que os fallbacks e uploads usem as novas permissões.


## V20 — Admin rápido + PayOnPag PIX

### Performance do painel
- feedback visual imediato no clique dos itens do menu;
- barra de progresso entre seções;
- transição curta do conteúdo;
- cache de GETs administrativos por 20 segundos;
- prefetch das principais APIs ao passar o mouse/focar o item do menu;
- escritas invalidam o cache automaticamente;
- Error Boundary corrigido.

### PayOnPag
Nova área `Admin → PIX PayOnPag`:
- ativar/desativar gateway;
- configurar/trocar `api-secret`;
- configurar webhook público;
- mínimo/máximo de depósito;
- timeout;
- teste de `account-info`.

O segredo permanece server-side e também pode ser definido por `PAYONPAG_API_SECRET`.

Fluxo:
1. jogador informa valor e telefone;
2. backend cria `payment_requests`;
3. backend cria a transação PIX PayOnPag;
4. retorna `pix.payload`;
5. backend gera QR Code localmente;
6. frontend mostra QR + copia-e-cola;
7. webhook/polling consulta a transação diretamente no provedor;
8. somente `AUTHORIZED` é creditado;
9. transação Firestore idempotente impede crédito duplicado;
10. carteira é sincronizada com iGameWin quando o sync estiver ativo.

### Antes de usar pagamentos reais
Configure uma Firebase Service Account no backend e uma URL HTTPS pública para:
`/api/webhooks/payonpag`.

Sem Service Account, a V20 bloqueia a criação de PIX real para não aceitar dinheiro sem conseguir conciliar e creditar a carteira com segurança.


## V20.1 — PayOnPag defaults + live pending diagnostic

- PayOnPag vem habilitada por padrão no ambiente local entregue.
- `PAYONPAG_API_SECRET` foi configurado no backend conforme a credencial fornecida pelo proprietário.
- `PAYONPAG_RECIPIENT_ID` foi configurado como recipient padrão.
- O API Secret continua fora do frontend e aparece mascarado no Admin.
- Split possui chave liga/desliga e percentual de 0 a 80%.
- Por segurança, o recipient fica cadastrado, mas o split começa DESLIGADO e com 0%; assim nenhum percentual é redirecionado sem uma decisão explícita.
- Admin → PIX PayOnPag possui `Criar PIX pendente de R$ 1,00`, que chama account-info e cria uma transação PIX real de diagnóstico.
- O teste exibe status, Transaction ID, External ID e QR. A interface avisa para NÃO pagar o PIX de diagnóstico.
- Transações normais incluem `splits` somente quando `splitEnabled = true`, recipient configurado e percentual > 0.


## V20.2 — correção de webhook PayOnPag

A documentação da PayOnPag marca `webhook_url` como obrigatório na criação de transação. A V20.1 bloqueava o PIX antes de chamar o provedor quando esse campo estava vazio.

Na V20.2:
- teste administrativo usa R$ 10,00;
- em desenvolvimento/localhost, o PIX não é mais bloqueado por falta de webhook público;
- o sistema usa polling de `GET /v1/transactions/:id` para acompanhar o status;
- em produção, webhook HTTPS público continua obrigatório;
- o Admin mostra webhook efetivo, origem e modo de confirmação;
- webhook responde HTTP 200 imediatamente e reconcilia de forma assíncrona, conforme a recomendação da documentação;
- o payload de webhook nunca credita saldo sozinho: o backend reconsulta a transação na PayOnPag.


## V20.3 — PayOnPag no banco + perfil de depósito

### PayOnPag
As configurações sensíveis do gateway são sincronizadas em:
`system_private/payonpag`

O documento privado guarda:
- `apiSecret`;
- `recipientId`;
- status ativo;
- webhook;
- limites;
- timeout;
- configuração de split.

Se o Firebase Admin SDK local não possuir Service Account, o backend usa o Firebase ID Token do administrador para gravar o documento pela Firestore REST API, respeitando `firestore.rules`.

O endpoint público nunca devolve o API Secret. O Admin recebe somente uma versão mascarada.

### Cadastro
Telefone com DDD passou a ser obrigatório no fluxo de criação de conta e é gravado em `users/<uid>.phone`.

### Depósito
A tela de depósito não solicita mais telefone nem exibe CPF. Ela mostra somente o nome do titular. CPF e telefone necessários à PayOnPag são lidos silenciosamente do cadastro salvo no Firestore.


## V21 — Netlify Ready + responsividade

### Arquitetura
- React/Vite continua como frontend.
- Express é exportado como app e encapsulado por `serverless-http`.
- `netlify/functions/api.mjs` atende todas as rotas `/api/*`.
- `netlify.toml` configura build, Function, rewrites da API, fallback SPA e cache de assets.
- Node 20 definido para build.

### Responsividade
Foram adicionadas correções para:
- 320px/360px/390px/430px;
- tablets;
- desktop e telas largas;
- safe-area de iPhone;
- modo landscape;
- tabelas administrativas roláveis;
- drawers e Banner Manager mobile;
- QR PIX e QR de diagnóstico fluidos;
- preferência `prefers-reduced-motion`.

### Performance
`src/main.tsx` carrega `App` ou `AdminApp` por import dinâmico, evitando baixar o painel administrativo para usuários comuns. O erro antigo do bootstrap de `initMarketingTracking` também foi corrigido.

### PayOnPag no Netlify
O backend reconhece automaticamente:
- `PUBLIC_APP_URL`;
- `URL`;
- `DEPLOY_PRIME_URL`.

Assim, em produção, o webhook pode ser resolvido para:
`https://SEU-SITE/api/webhooks/payonpag`.

O webhook realiza reconciliação antes de responder, porque trabalho iniciado após finalizar uma resposta HTTP não é confiável em uma Function serverless.

### WhatsApp/Baileys
Baileys exige um processo persistente com WebSocket e storage de sessão. Netlify Functions não são um processo persistente. Na V21 esse módulo fica isolado e apresenta uma explicação no Admin em vez de quebrar ou ficar tentando gerar QR indefinidamente.

Use um backend persistente somente para Baileys ou a API oficial do WhatsApp.

Veja `NETLIFY_DEPLOY.md`.


## V21.1 — correção do build TypeScript no Netlify

Esta versão corrige os erros reais enviados pelo build de produção da Netlify:

- `AdminApp.tsx`: usuário Firebase possivelmente `null` dentro do callback assíncrono;
- `AdminApp.tsx`: callbacks `useEffect(load, [])` que retornavam `Promise<void>`;
- `App.tsx`: campos antigos `provider_code`, `provider_name` e `game_name` trocados pelos campos normalizados `providerCode`, `providerName` e `name`;
- `UserProfile`: adicionados os campos utilizados pela Home (`totalDeposits`, `vip`, etc.);
- `adminLocalFallback.ts`: retorno de coleções Firestore tipado como registros dinâmicos, evitando a inferência incorreta `{ id: string }[]`.

O build continua sendo `tsc -b && vite build`: nenhum erro foi escondido removendo o TypeScript do pipeline.


## V21.2 — APIs pré-configuradas + bootstrap do banco

A V21.2 já possui defaults server-side para:
- Firebase Web;
- administrador principal;
- iGameWin;
- API CPF;
- PayOnPag + recipient.

Ao entrar no Admin, o frontend chama automaticamente:
`POST /api/admin/bootstrap-defaults`

Esse endpoint preenche/atualiza:
- `system_private/payonpag`
- `system_private/cpf_api`
- `system_private/igamewin`
- `system/settings`
- `system/winners_config`
- `system/home_layout`
- `public_config/marketing_tracking`
- documento do administrador em `users/<uid>`

O bootstrap tenta Firebase Admin SDK e, quando a sessão Admin possui permissão pelas Firestore Rules, usa Firestore REST como fallback.

### Única credencial não incluída
`FIREBASE_SERVICE_ACCOUNT_JSON` não foi fornecida e não pode ser inventada. Ela é necessária no Netlify para operações backend realmente privilegiadas, principalmente reconciliação financeira por webhook, Firebase Auth Admin e operações Firestore sem um usuário logado.

## V22 — estabilidade do banco + KYC completo
- CPF e PayOnPag agora confirmam persistência no Firestore antes de responder sucesso.
- API CPF usa `system_private/cpf_api`; PayOnPag usa `system_private/payonpag`.
- KYC mobile-first em 4 etapas: documento, selfie por câmera, comprovante e dados pessoais.
- Arquivos KYC são enviados ao Firebase Storage em `kyc/{uid}/...`.
- Solicitação consolidada em `kyc_requests/{uid}` com status `UNDER_REVIEW`.
- Admin KYC exibe arquivos e permite aprovar, pedir reenvio ou reprovar.
- Jogadores no Admin têm cards mobile com botão Gerenciar sempre visível.
- A captura facial é uma validação de UX/captura, não substitui prova biométrica certificada. Para detecção local avançada, MediaPipe Tasks Vision pode ser conectado posteriormente.


## V22.1 — credenciais fixas no backend

- PayOnPag `api-secret` definido no módulo server-only `server/platform-defaults.mjs`.
- PayOnPag `recipientId` definido no mesmo módulo e não editável pelo Admin.
- API CPF definida no backend e removida da navegação/configuração do Admin.
- O Admin PayOnPag exibe apenas estado mascarado/read-only das credenciais.
- O Admin continua permitindo alterar somente regras operacionais: gateway ativo, webhook, limites, timeout e split.
- O backend ignora `apiSecret` e `recipientId` enviados pelo navegador.
- Segredos não são mais gravados no Firestore durante bootstrap/configuração; o banco mantém somente metadados/regras operacionais.


## V22.2 — correção do CPF automático no cadastro

- O CPF agora dispara a consulta automaticamente ao atingir 11 números.
- A consulta recebe diretamente os 11 dígitos digitados, evitando race condition do state React.
- O endpoint aceita GET e POST.
- No Netlify, o frontend usa `GET /api/public/cpf/lookup?cpf=...`, evitando perda do body JSON em proxy/serverless.
- Ao colar um CPF completo, a validação também dispara automaticamente.
- O nome retornado pela API continua preenchendo o campo de nome automaticamente.
- O botão manual permanece apenas como "Validar novamente" quando necessário.


## V22.3 — correção INVALID_AMOUNT no PIX

A validação do depósito PayOnPag foi endurecida:
- aceita `10`, `10.00`, `10,00` e valores formatados em reais;
- o mínimo efetivo volta a ser sempre R$ 10,00;
- valores antigos salvos no Firestore não podem mais aumentar acidentalmente o mínimo;
- máximo efetivo: R$ 100.000,00;
- a Home ganhou preset R$ 10;
- erro `INVALID_AMOUNT` agora retorna mensagem, valor recebido e limites;
- os limites ficam read-only no Admin para evitar configuração inconsistente;
- `total_amount` e `items[0].price` são enviados como números em reais, conforme a documentação oficial da PayOnPag.


## V22.4 — correção definitiva do payload de valor PIX

A V22.4 corrige o caso em que o backend recebia o body sem `amount` válido em ambiente Netlify/proxy.

Mudanças:
- backend aceita `amount`, `value`, `total_amount`, query e header fallback;
- `express.urlencoded()` habilitado além de `express.json()`;
- frontend envia `amount`, `value` e `total_amount` com o mesmo número normalizado;
- endpoint autenticado `/api/wallet/payonpag/debug-amount` permite confirmar como o servidor está enxergando o valor;
- mensagens de erro agora mostram apenas dados seguros de diagnóstico sobre o valor recebido e content-type.


## V22.5 — backend de pagamentos revisado

Revisão completa do fluxo PayOnPag:

1. `GET /api/admin/payonpag/preflight`
   - testa credencial PayOnPag via `/v1/account-info`;
   - testa acesso administrativo ao Firestore;
   - verifica webhook efetivo;
   - retorna latência e diagnóstico por etapa.

2. `GET /api/wallet/payonpag/preflight`
   - verifica backend, Firestore e cadastro do jogador antes do PIX.

3. `POST /api/wallet/payonpag/deposit`
   - normaliza valores BR;
   - valida nome/e-mail/telefone/CPF;
   - valida Firestore Admin antes de aceitar dinheiro;
   - persiste `payment_requests` antes da chamada externa;
   - chama `POST https://api.payonpag.io/v1/transactions`;
   - trata `hasError=true` mesmo em HTTP 2xx;
   - exige `transaction.id`;
   - exige `pix.payload`;
   - salva erro do provedor sanitizado quando a criação falha;
   - gera QR Code somente depois de receber um payload PIX válido.

4. Logs
   - `payment_provider_logs` recebe CREATE_REQUEST / CREATE_SUCCESS / CREATE_FAILED;
   - documentos e telefone são mascarados;
   - secrets/tokens são removidos do log.

5. IP
   - prioriza `x-nf-client-connection-ip`, `cf-connecting-ip` e `x-forwarded-for`.

6. Frontend
   - parser correto para `10`, `10.00`, `10,00` e `1.234,56`;
   - mensagens reais do provedor são exibidas quando disponíveis.

### Requisito obrigatório em produção
O fluxo financeiro seguro precisa de `FIREBASE_SERVICE_ACCOUNT_JSON` no Netlify. Sem essa credencial, a V22.5 retorna `PAYMENT_BACKEND_NOT_READY` antes de criar um PIX que depois não poderia ser conciliado/creditado.


## V22.6 — depósito PIX normal alinhado ao teste + redução de latência

O teste administrativo conseguia gerar PIX porque ia quase direto ao provedor. O fluxo normal acumulava várias operações de Firestore antes e depois da chamada PayOnPag.

Na V22.6:
- removida a leitura redundante `checkFirestoreAdminReady()` do caminho do depósito;
- uma única leitura do perfil do jogador comprova acesso ao Firestore e os perfis ficam em cache por 2 minutos;
- apenas `payment_requests` é persistido antes de chamar o provedor;
- `payment_provider_logs` deixou de bloquear a resposta;
- geração do QR Code e atualização final do Firestore acontecem em paralelo;
- resposta inclui `providerLatencyMs` e `totalLatencyMs`;
- header `Server-Timing` permite verificar onde houve demora;
- frontend mostra feedback imediatamente e cancela uma chamada travada após 25 segundos;
- payload normal usa exatamente os campos obrigatórios da PayOnPag: external_id, total_amount, PIX, webhook_url, items, ip e customer.


## V22.7 — backend de depósito refeito com valor no endpoint

A origem do erro `Informe um valor numérico válido para o depósito` estava antes da PayOnPag: o backend não conseguia extrair `amount` de forma confiável da requisição normal em produção.

A V22.7 elimina essa dependência:
- frontend chama `POST /api/wallet/payonpag/deposit/10.00`;
- backend lê primeiro `req.params.amount`;
- o body deixa de transportar o valor;
- `total_amount` é reconstruído server-side como `Number`;
- `items[0].price` recebe o mesmo `Number`;
- a rota antiga `/api/wallet/payonpag/deposit` continua disponível por compatibilidade.

Payload PayOnPag continua seguindo a documentação:
`external_id`, `total_amount`, `payment_method`, `webhook_url`, `items`, `ip`, `customer` e `splits` somente quando configurado.


## V22.8 — depósito sem dependência obrigatória de Firebase Admin

A falha `O backend não conseguiu acessar o Firestore para processar o depósito` acontecia porque o fluxo normal de PIX tratava o Firebase Admin SDK como requisito antes de chamar a PayOnPag.

A V22.8 separa as responsabilidades:
- Firebase Auth continua identificando o jogador;
- perfil do usuário é lido por Firebase Admin quando disponível ou Firestore REST + ID Token quando não está;
- PayOnPag cria o PIX normalmente;
- Netlify Blobs mantém um ledger financeiro server-side persistente e com leitura forte;
- Firestore recebe uma cópia/espelho quando estiver disponível;
- webhook e polling reconciliam a transação diretamente com `GET /v1/transactions/:id`;
- crédito é idempotente pelo transaction ID;
- iGameWin é creditada apenas uma vez por depósito;
- `/api/wallet/summary` fornece o saldo financeiro híbrido para a interface;
- Firestore Admin passa a ser melhoria/espelho, não requisito para gerar o PIX.

Netlify Blobs é usado somente no backend; nenhuma chave do ledger é exposta diretamente ao navegador.


## V22.9 — hotfix banner + valor PIX

Correções:
- `/api/banner-campaigns` nunca mais retorna 500 por falta de Firebase Admin; em caso de indisponibilidade retorna HTTP 200 com `banners: []`;
- `/api/banner-events` é best-effort e não derruba a Home;
- depósito envia o valor simultaneamente em query, header e body;
- backend prioriza `req.query.amount`, depois `x-amora-amount`, depois path/body;
- erro `INVALID_AMOUNT` mostra quais fontes chegaram ao backend;
- rota de debug aceita GET e POST.


## V24 — Firebase amorabet + performance + logo oficial

- Projeto Firebase padrão alterado para `amorabet`.
- Firebase Web: Auth, Firestore, Realtime Database e Storage inicializados pelo mesmo app.
- Realtime Database usado como camada rápida de configurações públicas/runtime.
- Storage organizado em `banners/`, `popups/`, `promotions/`, `system/`, `avatars/` e `kyc/`.
- Logo oficial em `public/brand/amora-bet-logo.png`; ícone provisório A removido das áreas principais.
- CPF: configuração fixa no backend sem leitura do Firestore no caminho crítico, keep-alive HTTP, cache de 24h e coalescência de consultas iguais.
- PIX: credencial/configuração fixa em memória, keep-alive, dados do cliente enviados pelo frontend evitando leitura do banco quando completos e espelho Firestore fora do caminho crítico do QR.
- Admin: GETs Firestore-safe usam conexão direta do Firebase Client, cache de 60s e jogadores paginados em 25 por página.
- Banners: upload no Firebase Storage com metadados de dimensões e previews Desktop/Tablet/Mobile/Popup.
- KYC: preenche CPF/nascimento/telefone/endereço já cadastrados, selfie otimizada e layout full-screen em celulares.

### Firebase atual
- Project ID: `amorabet`
- Auth Domain: `amorabet-f4405.firebaseapp.com`
- Realtime Database: `https://amorabet-f4405-default-rtdb.firebaseio.com`
- Storage: `amorabet-f4405.firebasestorage.app`

Publique `firestore.rules`, `database.rules.json` e `storage.rules` no projeto novo antes de usar em produção.


## V24.2 — Admin + depósito sem CPF/telefone visíveis
- `administrador@gmail.com` é bootstrap admin por e-mail no backend e frontend.
- A conta administrativa autenticada é marcada `role=admin`/`admin=true` no documento do próprio UID durante o bootstrap.
- A tela de depósito não exibe nem solicita CPF ou telefone.
- Ao clicar em Gerar PIX, o backend lê `users/{uid}` e usa CPF/telefone persistidos no cadastro.
- O cache local do cadastro é apenas fallback silencioso para a janela logo após a criação da conta.


## V24.4 — Bug de idioma com bônus real

Em Configurações o administrador pode ativar **Bug de idioma • bônus real**.

Quando ativo:
- o ícone de chat do header vira um globo;
- o jogador escolhe Brasil, Rússia ou Japão;
- Brasil apenas mantém o idioma;
- Rússia e Japão mostram a campanha localizada;
- o valor real creditado é definido em BRL no Admin;
- valores visuais em RUB/JPY e mensagens localizadas também são configuráveis;
- o resgate é limitado a uma vez por conta;
- o backend usa transação Firestore em `users/<uid>` + `language_bonus_claims/<uid>`;
- o saldo `walletBalance` e `balance` é atualizado;
- o valor também incrementa `bonusBalance` e `totalBonuses`;
- após o crédito principal o backend tenta sincronizar o mesmo valor na iGameWin;
- o frontend atualiza o saldo imediatamente após resposta bem-sucedida.

A interface identifica a recompensa como bônus promocional real para não confundir o usuário sobre a origem do crédito.


## V24.5 — Configuração persistente, Influenciadores, KYC por câmera e Vencedores

- **Salvar tudo** agora grava primeiro no backend. Se Firebase Admin não puder escrever, o servidor tenta Firestore REST com o ID Token do Admin. Falha no espelho do Realtime Database não faz mais a tela dizer que a gravação principal falhou.
- Jogadores podem ser marcados como `influencer` no drawer de gerenciamento.
- O bônus de idioma suporta regra transparente de elegibilidade:
  - influenciadores podem ignorar o mínimo de depósito quando habilitado;
  - jogadores comuns recebem o valor necessário e um CTA para a área de depósito;
  - primeiro depósito é registrado em `firstDepositAmount`;
  - apenas um resgate por conta.
- Depois de resgatar o bônus de idioma, o primeiro saque exige KYC aprovado.
- KYC de documento e comprovante usa captura de imagem pela câmera (`capture="environment"`), sem PDF.
- O KYC também coleta nome/CPF/chave PIX do destinatário do saque.
- Central de Vencedores carrega catálogo iGameWin para o Admin selecionar jogos, possui gerador de nomes/valores aleatórios e salva `gameCode/providerCode`.
- Configurações da Central de Vencedores também possuem fallback de persistência.


## V24.6 — taxas de saque transparentes

O Admin passa a ter mais de 18 modelos de taxa configurável. Cada regra pode ser ativada/desativada, renomeada, definida como valor fixo ou percentual e complementada com novas regras personalizadas.

O jogador vê antes da confirmação:
- valor bruto solicitado;
- cada taxa aplicada;
- total de taxas;
- valor líquido a receber.

O backend recalcula e grava `grossAmount`, `feeAmount`, `netAmount` e `appliedFees` em cada solicitação.

O Financeiro exibe uso e valor por taxa.

Esta versão não usa PIX separado como condição para liberar saldo já pertencente ao jogador; as taxas são incorporadas e exibidas no próprio saque.


## V24.7 — visual do idioma e faixa do bônus

- Usa as imagens fornecidas pelo usuário para Brasil, Rússia e Japão.
- O popup de idioma não usa mais emojis como ícone principal.
- A seleção de idioma fica persistida em `localStorage`.
- Ao selecionar Rússia ou Japão, uma faixa compacta aparece imediatamente acima do banner principal da Home.
- A faixa mostra imagem do país, mensagem localizada, valor visual em RUB/JPY e botão de claim.
- O botão da faixa abre novamente o popup de resgate.
- Layout foi otimizado para desktop e celular.


## V24.8 — idioma fecha ao selecionar + resgate direto na Home

- O popup de idioma serve somente para escolher Brasil, Rússia ou Japão.
- Qualquer seleção fecha o popup imediatamente.
- Rússia/Japão mostram a oferta apenas na faixa acima do banner principal.
- O botão da faixa é `RESGATAR`.
- O resgate chama diretamente o backend e aplica as regras configuradas:
  - influenciador pode ter bypass;
  - jogador comum sem mínimo suficiente recebe a exigência em português.
- Quando faltar depósito, a faixa troca para:
  `Você deve ter no mínimo R$ X depositado.`
  e mostra `DEPOSITAR`, levando para a área de depósito.
- Ao cumprir a regra, o resgate credita o bônus e atualiza o saldo visível.


## V24.9 — correção `Could not load the default credentials`

O erro acontecia porque o servidor local inicializava `firebase-admin` sem uma Service Account e depois tentava executar uma transação privilegiada no Firestore.

A V24.9 usa dois caminhos:

1. **Backend Admin**, quando existe credencial administrativa.
2. **Firebase Web autenticado**, quando está em localhost/sem Service Account.

O fallback do navegador usa uma transação Firestore protegida por regras específicas:
- somente o próprio UID;
- somente Rússia/Japão;
- promoção precisa estar ativa;
- valor creditado precisa ser exatamente o configurado em `system/settings`;
- regras de depósito/influenciador são revalidadas;
- apenas os campos do bônus podem mudar;
- `language_bonus_claims/<uid>` impede segundo resgate.

O backend também não expõe mais a mensagem interna do Google sobre Application Default Credentials. Ele retorna `FIREBASE_ADMIN_UNAVAILABLE` para que a interface use o fallback.

### Primeira execução desta versão

Publique as novas regras do Firestore uma vez:

```bash
npm run firebase:rules
```

O projeto alvo já está definido como `amorabet`.


## V24.10 — estabilidade do idioma

Correções:
- removida a referência inválida a `snap` nos defaults de `getPlatformSettings`;
- nenhum erro técnico como `snap is not defined`, Firestore ou credenciais do Google é exibido ao jogador;
- todo jogador inicia a sessão em **Brasil**;
- a escolha Rússia/Japão não fica salva entre novas sessões;
- a mensagem do bônus continua aparecendo somente na faixa acima do banner;
- Brasil nunca mostra a faixa promocional;
- o Admin pode ativar a promoção em:
  - Rússia + Japão;
  - somente Rússia;
  - somente Japão;
  - nenhum deles, mantendo o seletor disponível;
- backend, fallback Firebase Web e Firestore Rules validam a ativação do idioma escolhido.


## V24.11 — Design Studio no painel Admin

Nova seção **Produto → Design Studio**:
- nome da plataforma;
- upload e URL da logo;
- paleta completa (principal, fundo, superfícies, textos e botões);
- arredondamento geral e de cards;
- estilo da barra mobile: flutuante, reta ou pílula;
- proporção de cards de jogos: 1:1, 4:5 ou 16:9;
- modo compacto;
- mostrar/ocultar nomes de providers e rótulo de saldo;
- renomear itens principais da navegação;
- upload de ícones próprios para Menu, Cassino, Início, Depósito e Perfil;
- reordenação da Home por drag-and-drop;
- preview Mobile/Desktop em tempo real antes de publicar.

O design é salvo em `system/settings.visualTheme`, espelhado em `runtime/publicSettings` e aplicado pela plataforma via variáveis CSS. Login/cadastro também carregam logo e nome configurados.

Uploads visuais usam Firebase Storage em `design/logo/` e `design/icon/`.


## V24.11.1 — Stability Audit

A auditoria verificou sintaxe do backend, sintaxe TS/TSX, fixtures do parser iGameWin e os contratos principais de Design Studio, tema runtime, autenticação visual, CPF, PayOnPag, saques, vencedores e catálogo.

Correção adicional:
- `/api/admin/home-layout` agora possui fallback Firestore REST quando o Firebase Admin local não tem Application Default Credentials.
- a ordem da Home é sanitizada por whitelist, remove duplicatas e reinsere seções obrigatórias ausentes.

Observação: integrações externas reais (PayOnPag, iGameWin, CPF e Firebase remoto) dependem de rede, credenciais válidas e configuração do ambiente; esta auditoria não gera cobranças reais nem faz operações financeiras de produção.

# Auditoria v0.24.11.1 → v0.24.11.2

## Problemas encontrados no código original

1. Firebase Admin podia inicializar sem credencial privilegiada e várias rotas tentavam continuar usando o SDK, gerando `Could not load the default credentials`.
2. A autorização administrativa aceitava custom claims, documento Firestore e fallback REST delegado. Isso tornava o fluxo mais complexo e contrariava a necessidade de `ADMIN_EMAILS`/`ADMIN_UIDS` serem a autoridade de bootstrap.
3. O frontend do Admin possuía fallback local de Firestore e e-mails administrativos hardcoded.
4. `.env.example` e um arquivo de configuração antigo continham credenciais privadas reais.
5. CORS estava em `origin:true`.
6. O backend usava apenas `PORT`, sem bind explícito em `127.0.0.1`.
7. Não havia configuração PM2 de produção para o cenário solicitado.
8. Não havia configuração Nginx específica para `/var/www/html` + `/api/` → `127.0.0.1:8787`.
9. Erros do backend podiam devolver `providerData` bruto em produção.
10. O painel podia tentar um fallback visual baseado em Firestore quando a validação administrativa falhava.

## Correções aplicadas

- `.env`/`.env.local` carregados antes do import dinâmico/inicialização do Firebase Admin;
- prioridade `FIREBASE_SERVICE_ACCOUNT_JSON` → `GOOGLE_APPLICATION_CREDENTIALS`;
- rotas autenticadas retornam `503` sem Firebase Admin em vez de tentar bypass;
- Admin: token válido → `getUser(uid)` → comparação estrita com `ADMIN_UIDS`/`ADMIN_EMAILS`;
- `401` para ausência/token inválido; `403` para usuário não autorizado;
- removido fallback administrativo do frontend;
- removido bootstrap Admin hardcoded do frontend;
- `/api/health` seguro e sem segredos;
- CORS same-origin + allowlist;
- rate limits em rotas críticas;
- segredos removidos dos defaults/documentos versionáveis;
- iGameWin/CPF/PayOnPag passam a buscar segredos do ambiente;
- PM2, Nginx, scripts de install/update/diagnóstico;
- auditoria e smoke tests adicionados.

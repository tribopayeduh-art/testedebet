# AMORA BET v0.24.11.2 — PRODUÇÃO VPS INTEGRATOR

Base auditada: **v0.24.11.1**. O design e as funcionalidades existentes foram preservados. Esta revisão altera principalmente inicialização, autenticação administrativa, segurança, proxy e operação em VPS.

## Arquitetura de produção

```text
Navegador
  ├─ /assets, /admin, /... → Nginx → /var/www/html
  └─ /api/...             → Nginx → 127.0.0.1:8787 → Express/PM2
                                                  ├─ Firebase Admin
                                                  ├─ iGameWin
                                                  ├─ API CPF
                                                  ├─ PayOnPag
                                                  └─ Baileys
```

O navegador nunca deve acessar `:8787` diretamente.

## 1. Windows — chegar na pasta

Depois de extrair o ZIP em Downloads:

```bat
cd /d "%USERPROFILE%\Downloads\amora-bet-v0.24.11.2-vps-production"
```

Instalar e validar localmente:

```bat
npm install
npm run prod:audit
npm run build
npm run dev
```

Frontend local: `http://localhost:5173`
Backend local: `http://127.0.0.1:8787`

## 2. Enviar para a VPS

No Windows, a partir de Downloads:

```bat
cd /d "%USERPROFILE%\Downloads"
scp "amora-bet-v0.24.11.2-vps-production.tar.gz" root@SEU_IP:/root/
```

Entrar na VPS:

```bat
ssh root@SEU_IP
```

## 3. Primeira instalação na VPS

```bash
rm -rf /root/amora-deploy
mkdir -p /root/amora-deploy
tar -xzf /root/amora-bet-v0.24.11.2-vps-production.tar.gz -C /root/amora-deploy --strip-components=1
cd /root/amora-deploy
sudo bash deploy/install-vps.sh
```

O instalador prepara:

- `/var/www/amora-bet` — backend/código;
- `/var/www/html` — somente `dist` do Vite;
- `/var/www/amora-bet/secrets` — credenciais privadas;
- `/var/log/amora-bet` — logs PM2;
- PM2 `amora-bet-api`;
- Nginx `/api/` → `127.0.0.1:8787`.

## 4. Configurar `.env.local`

```bash
sudo nano /var/www/amora-bet/.env.local
```

Copie os valores necessários de `.env.example`. Depois proteja:

```bash
sudo chown amorabet:amorabet /var/www/amora-bet/.env.local
sudo chmod 600 /var/www/amora-bet/.env.local
```

### Firebase Admin recomendado na VPS

Use arquivo, não JSON dentro do frontend:

```bash
sudo mkdir -p /var/www/amora-bet/secrets
sudo nano /var/www/amora-bet/secrets/firebase-service-account.json
sudo chown -R amorabet:amorabet /var/www/amora-bet/secrets
sudo chmod 700 /var/www/amora-bet/secrets
sudo chmod 600 /var/www/amora-bet/secrets/firebase-service-account.json
```

No `.env.local`:

```env
GOOGLE_APPLICATION_CREDENTIALS=/var/www/amora-bet/secrets/firebase-service-account.json
FIREBASE_PROJECT_ID=amorabet
ADMIN_EMAILS=admin@seudominio.com,outro-admin@seudominio.com
ADMIN_UIDS=UID_1,UID_2
```

Use `FIREBASE_SERVICE_ACCOUNT_JSON` apenas se preferir armazenar o JSON completo em uma variável de ambiente. Se as duas formas existirem, `FIREBASE_SERVICE_ACCOUNT_JSON` tem prioridade.

Reinicie:

```bash
sudo -u amorabet -H pm2 restart amora-bet-api --update-env
sudo -u amorabet -H pm2 save
```

## 5. Testes de backend e proxy

Backend direto:

```bash
curl -i http://127.0.0.1:8787/api/health
curl -i http://127.0.0.1:8787/api/providers
curl -i http://127.0.0.1:8787/api/games
```

Pelo Nginx/IP:

```bash
curl -i http://SEU_IP/api/health
curl -i http://SEU_IP/api/providers
curl -i -X POST http://SEU_IP/api/admin/whatsapp/connect
```

O último, **sem token**, deve responder `401`. Se responder `405`, o Nginx não está usando a configuração de proxy correta.

Ver Nginx:

```bash
sudo nginx -t
sudo nginx -T | grep -A25 -B3 "location /api/"
```

Ver porta:

```bash
ss -ltnp | grep 8787
```

## 6. Teste administrativo autenticado

O frontend força `getIdToken(true)` antes de liberar o Admin. Para testar manualmente por terminal, use temporariamente um Firebase ID Token em uma variável da sessão:

```bash
export ADMIN_ID_TOKEN='COLE_TOKEN_TEMPORARIO_AQUI'
BASE_URL=http://127.0.0.1:8787 npm run smoke
unset ADMIN_ID_TOKEN
```

Não grave esse token em `.env` ou em logs.

Resultados esperados:

- token ausente/inválido → `401`;
- token válido, mas e-mail/UID fora das listas → `403`;
- Firebase Admin não configurado → `503`;
- token válido + usuário em `ADMIN_EMAILS` ou `ADMIN_UIDS` → `200`.

## 7. Atualizações futuras

Envie o novo TAR.GZ e extraia em `/root/amora-update`:

```bash
rm -rf /root/amora-update
mkdir -p /root/amora-update
tar -xzf /root/NOVA_VERSAO.tar.gz -C /root/amora-update --strip-components=1
cd /root/amora-update
sudo bash deploy/update-vps.sh
```

O script preserva:

- `.env.local`;
- `secrets/`;
- `.wa-auth/`;
- credenciais e sessão WhatsApp.

## 8. PM2

```bash
sudo -u amorabet -H pm2 status
sudo -u amorabet -H pm2 logs amora-bet-api
sudo -u amorabet -H pm2 restart amora-bet-api --update-env
sudo -u amorabet -H pm2 save
```

Logs em disco:

```text
/var/log/amora-bet/api-out.log
/var/log/amora-bet/api-error.log
```

## 9. Diagnóstico completo

```bash
sudo bash /var/www/amora-bet/deploy/diagnose-vps.sh
```

E o smoke test:

```bash
cd /var/www/amora-bet
BASE_URL=http://127.0.0.1:8787 npm run smoke
```

## 10. Segurança aplicada

- segredos não ficam em `VITE_*`;
- frontend utiliza somente `/api/...` relativo;
- Firebase Admin não concede Admin por documento Firestore ou fallback do navegador;
- Admin depende de token Firebase válido + `ADMIN_EMAILS`/`ADMIN_UIDS`;
- Service Account fica fora de `public` e `dist`;
- CORS aceita same-origin e origens explicitamente configuradas;
- rate limit em Admin, depósito, saque e KYC;
- respostas `5xx` não devolvem payload bruto de integrações em produção;
- Nginx bloqueia `.env`, service account, `server`, `src`, `deploy`, chaves e arquivos de configuração;
- backend escuta em `127.0.0.1` por padrão;
- PM2 executa como usuário Linux `amorabet`;
- autenticação de login continua no Firebase Auth; o backend não recebe senha. O próprio Firebase aplica proteção de abuso/rate limiting do login.

## 11. Observação sobre cookies

A versão atual autentica as APIs com `Authorization: Bearer <Firebase ID Token>` e não usa cookie de sessão próprio. Portanto não há cookie de autenticação do backend para configurar nesta revisão. Se futuramente forem introduzidos cookies, utilize `HttpOnly`, `Secure` e `SameSite=Lax` ou `Strict` conforme o fluxo.

# Conexões ZeroBet

Configuração verificada: frontend e backend usam Firebase, mesmo projeto e mesmo banco nomeado. npm run dev serve API e frontend juntos na porta 3000.

Correções: indicador Firestore retorna falso se a leitura falha; system-readiness confirma acessos antes de anunciar READY; banco do frontend aceita VITE_FIRESTORE_DATABASE_ID; comandos de deploy apontam para o projeto ZeroBet e regras para o banco nomeado. Nenhuma regra foi publicada por esta revisão.

Build e verificações locais passaram. Não foi feito teste autenticado remoto. Falta credencial Firebase Admin. Para gerenciar contas no servidor, configure GOOGLE_APPLICATION_CREDENTIALS para um JSON válido da conta de serviço do mesmo projeto, ou FIREBASE_SERVICE_ACCOUNT_JSON, sem prefixo VITE_. Não envie chaves privadas ao frontend.

Fornecedor e gateway têm configurações padrão presentes; validade das credenciais e webhooks não foi confirmada. Não houve pagamentos nem movimentação real de saldo. Firebase Hosting está configurado apenas para frontend estático: o backend Express requer hospedagem própria ou rewrite para serviço implantado. Para teste local use npm run dev, não npm run frontend.

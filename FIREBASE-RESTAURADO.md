# Firebase restaurado
Frontend e servidor usam Firebase. A configuração original do firebase-applet-config.json foi preservada, incluindo o banco nomeado ZeroBet. As rotas legadas do admin voltam a ser utilizadas.
Iniciar: npm install e npm run dev. Site: http://localhost:3000; admin: http://localhost:3000/admin.
Use a conta cadastrada anteriormente no Firebase. Contas criadas apenas no Supabase não são copiadas para o Firebase.
Não precisa executar SQL. Nenhum dado remoto foi apagado ou transferido.
Acesso privilegiado no servidor depende da conta de serviço Firebase da hospedagem (FIREBASE_SERVICE_ACCOUNT_JSON ou GOOGLE_APPLICATION_CREDENTIALS). Sem ela, as rotas delegadas dependem das permissões anteriores do Firestore. Não houve teste de operações reais no banco remoto nesta restauração.

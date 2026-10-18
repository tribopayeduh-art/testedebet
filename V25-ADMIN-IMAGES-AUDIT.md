# Playzada V25 — Admin e imagens

## Alterações realizadas

- Redesign geral do Control Center com maior legibilidade, espaçamento, hierarquia visual e responsividade.
- Sidebar reorganizada visualmente e topbar com contexto da seção atual, status operacional e atalho funcional de notificações.
- Dashboard com resumo operacional, margem estimada, pendências e atalhos de monitoramento.
- Catálogo de jogos com cards maiores, estados de carregamento e fallback quando a capa não estiver disponível.
- Correção da normalização de imagens relativas da iGameWin usando a origem configurada em `IGAMEWIN_API_URL`.
- Proxy assinado e com cache para imagens externas dos jogos, evitando bloqueio de hotlink e mantendo validação contra URLs arbitrárias.
- Cache do catálogo atualizado para a versão V3, eliminando referências antigas quebradas.
- Referência inexistente do popup Desafio Tiger substituída pelo asset mobile que já acompanha o projeto.

## Validações

- TypeScript: aprovado.
- Build Vite de produção: aprovado.
- Sintaxe do backend Node.js: aprovada.
- Auditoria dos módulos administrativos: aprovada.
- Auditoria de assets estáticos referenciados: sem arquivos ausentes.

## Windows

```bat
cd /d "%USERPROFILE%\Downloads\playzada-v25-admin-imagens"
npm install
npm run build
npm run dev
```

Abra `http://localhost:3000/admin`.

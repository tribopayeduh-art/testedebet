# Relatório de testes — Amora BET V5

Data: 14/08/2026

## PASS — sintaxe backend
- `node --check server/index.mjs`
- `node --check scripts/test-igamewin.mjs`

## PASS — parser do catálogo
`npm run parser:test`

Casos verificados:
- resposta `data: []`
- resposta `provider_list: []`
- resposta aninhada `data.games: []`
- resposta em objeto indexado por código

Resultado: 4/4 casos aprovados.

## PASS — sintaxe/transpilação TS/TSX
Os arquivos foram analisados com o compilador TypeScript em modo `transpileModule`, sem depender da resolução de pacotes:
- `src/App.tsx`
- `src/AdminApp.tsx`
- `src/main.tsx`
- `src/pages/AuthPage.tsx`
- `src/lib/igamewin.ts`

Resultado: todos passaram sem erro de sintaxe.

## API iGameWin — correção aplicada
A causa lógica identificada no código anterior era a chamada inicial de `game_list` sem `provider_code`.

Fluxo novo:
1. `provider_list`
2. extrai cada `provider_code`
3. `game_list` individual por provider
4. agrega os jogos
5. remove duplicados
6. normaliza imagens e campos
7. disponibiliza tudo em `GET /api/igamewin/games`

## Teste real direto
O script `npm run igw:test` foi criado para validar na máquina/servidor:
- `money_info`
- `provider_list`
- `game_list` dos primeiros 5 providers
- quantidade de miniaturas retornadas

Neste ambiente de geração, a tentativa de POST externo foi bloqueada por resolução DNS (`EAI_AGAIN`). Isso é uma limitação de rede deste sandbox e não um retorno de autenticação da iGameWin.

Execute localmente:

```bash
npm install
npm run igw:test
```

Se o teste retornar jogos, o lobby usa exatamente as mesmas rotas e a mesma normalização.

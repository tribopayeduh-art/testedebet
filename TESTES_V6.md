# Testes V6

## Validações executadas

- `node --check server/index.mjs` — PASS
- `node --check scripts/test-igamewin.mjs` — PASS
- Assets dos novos banners copiados para `public/banners/`
- Home configurada para iniciar no banner Desafio Tiger
- Carrossel com autoplay, dots e swipe
- Login, cadastro e recuperação de senha conectados ao Firebase Authentication

## Build local

O ambiente de geração não conseguiu concluir `npm install` por timeout de rede. Na sua máquina, execute:

```bash
npm install
npm run build
npm run dev
```

O projeto já contém os imports de tipos React necessários para o novo formulário e para o swipe do carrossel.

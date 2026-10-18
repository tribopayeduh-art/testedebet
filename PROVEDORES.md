# Logos e faixa de provedores

35 imagens de marcas, usadas em 38 das 45 entradas do catálogo consultado.
As demais entradas mantêm os nomes do catálogo: Sport Betting, Original, Jin Ji Bao Xi, Sports, DU, HY, Gaming.

- Logos locais em `public/providers`, com origem registrada em `sources.json`.
- Mapeamento e variantes para fundo claro em `src/lib/providerLogos.ts`.
- Faixa contínua na página inicial, com todas as entradas e filtros por clique.
- Pausa por botão, mouse e foco. No modo pausado, rolagem manual.
- Movimento reduzido respeitado conforme a preferência do dispositivo.
- O catálogo continua dinâmico; marcas novas usam a imagem da API ou o nome.

Validação: build TypeScript/Vite e leitura das imagens. A interface completa ainda precisa ser conferida no navegador local.

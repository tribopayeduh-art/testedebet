# ZeroBet — vermelho vinho

Identidade ZeroBet no site, login, carteira e painel administrativo. Paleta: #160B11, #25101B, #321522, #922448 e #DC7294.

Mantidos e atualizados somente os 13 banners referenciados pelo código, em `public/banners/`, mais a imagem de verificação de saque em `public/verificacaosaque.png`. Nove banners sem referências foram excluídos; cópias redundantes e imagens de referência sem uso também foram removidas. Os caminhos de fallback agora reutilizam os mesmos arquivos.

Logo vetorial em `public/brand/zerobet-logo.svg`; ícone em `public/brand/zerobet-icon.svg`. Artes editadas com ferramenta integrada de imagens: preservar composição, personagens, textos e valores; substituir marcas por ZeroBet e aplicar vinho profundo com rubi.

Para executar: `npm install` e `npm run dev`. Build: `npm run build`.

Corrigidos dois problemas do ZIP original: módulo de rastreamento ausente e imagem de noscript posicionada dentro do head. Credenciais e integrações existentes foram preservadas.

Validação: compilação TypeScript/Vite e sintaxe dos módulos de backend. Artes inspecionadas visualmente; navegação desktop/mobile não validada em navegador neste ambiente. Pagamentos e operações reais não foram testados. Imagens personalizadas com nomes desconhecidos salvas remotamente continuam sob gestão do painel.

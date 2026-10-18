# Admin personalizável

- Interface branca com bordas suaves, menos sombras e atalhos para banners, aparência e taxas.
- Configurações em abas: geral, financeiro, taxas, banners e bônus.
- Alterações pendentes, botão para descartar e importação/exportação JSON.
- Troca de banners, popup, logo e ícones com upload autenticado de PNG, JPG e WebP até 15 MB. Os uploads são armazenados em uploads/design; preserve essa pasta nos backups e em atualizações do servidor.
- Paletas prontas e cores individuais, incluindo fundo, cards, texto, botões e bordas; prévia visual e organização das seções.
- Taxas atuais preservadas: primeiro saque 22,90; primeiro saque com bônus 32,90; aprovação KYC 21,90; conta PIX 19,67; antifraude 14,90; liquidação 9,90. Aprovação KYC antecipada mantém 20,90. Regras adicionais de desconto permanecem com seu estado atual (o padrão original é desativado).
- As etapas podem ser editadas/desativadas. A prévia e o envio do saque consultam a configuração; cobranças com valor antigo são recusadas para atualização da prévia.
- Corrigidos os nomes dos campos de limite percentual e taxa mínima do desbloqueio, alinhando o formulário ao backend.

## Rodar no CMD

cd /d "%USERPROFILE%\Downloads" && (if not exist zerobet-local mkdir zerobet-local) && tar -xf "zerobet-admin-personalizavel.zip" -C zerobet-local && cd zerobet-local && set "NODE_ENV=development" && npm install && npm run dev

Abra http://localhost:3000. Pare o servidor anterior com Ctrl+C antes de atualizar e recarregue com Ctrl+F5.

## Validação

node --check server/index.mjs
node --test tests/customization.test.mjs
npm run build

As operações autenticadas, a aparência no navegador e a integração PIX precisam de validação com sua conta/admin e o gateway configurado. O teste automatizado de valores e uploads não efetua pagamentos.

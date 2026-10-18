# Melhorias de carregamento

- Perfil, carteira e limites consultados em paralelo, com identidade obtida da sessão local. Permissões de operações continuam verificadas no servidor e no RLS.
- Uma assinatura de conta monitora as três tabelas sem consultar cada tabela duas vezes na abertura.
- Atualizações são serializadas; uma mudança durante a consulta mantém uma atualização posterior, sem sobreposição de pedidos.
- Consultas periódicas e atualizações automáticas esperam a aba ficar visível; o retorno à aba solicita dados atuais.
- Dados iguais não provocam nova atualização de estado.
- A consulta adicional de saldo pelo App é dispensada no modo Supabase: a assinatura da carteira já fornece o saldo.
- Jogos e provedores carregam de forma independente; requisições simultâneas de catálogo compartilham a mesma consulta.
- Tentativas internas repetidas foram reduzidas; retentativa controlada acontece em segundo plano, com retomada ao recuperar a conexão ou voltar à aba.
- Busca de jogos usa atualização diferida para manter a digitação responsiva.

Build TypeScript/Vite e 26 testes passaram. Não houve medição de velocidade no computador do usuário nem testes com sessão real. Disponibilidade externa e operações ainda não migradas continuam limitando a experiência. Esta versão não conclui a migração financeira e não exige novo SQL.

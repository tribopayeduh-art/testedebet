export function apiErrorMessage(status:number, data:any, fallback='Falha ao processar a solicitação.') {
  const server = data?.message || data?.details?.message || data?.details?.msg || data?.details?.error || data?.error;
  if (server && typeof server === 'string' && !/^HTTP_\d+$/.test(server)) return server;
  switch (status) {
    case 400: return 'Os dados enviados são inválidos. Confira as informações e tente novamente.';
    case 401: return 'Sua sessão expirou ou não é válida. Entre novamente.';
    case 403: return 'Sua conta não possui permissão para esta operação.';
    case 404: return 'A rota solicitada não existe no backend.';
    case 405: return 'A API não recebeu este método. Verifique se o Nginx está encaminhando /api/ para o backend.';
    case 429: return 'Muitas solicitações em pouco tempo. Aguarde alguns instantes.';
    case 500: return 'O servidor encontrou um erro interno.';
    case 502: return 'Uma integração externa não respondeu corretamente.';
    case 503: return 'O serviço necessário ainda não está configurado ou está temporariamente indisponível.';
    default: return fallback;
  }
}

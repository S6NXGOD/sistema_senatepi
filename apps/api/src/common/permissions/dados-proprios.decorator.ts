import { SetMetadata } from '@nestjs/common';

export const DADOS_PROPRIOS_KEY = 'dadosProprios';

/**
 * Marca um controller (ou rota) de AUTOATENDIMENTO: age exclusivamente sobre os
 * dados do próprio usuário autenticado (ex.: /profile — foto, nome, senha).
 *
 * Efeito: isenta a rota da regra global "só o Administrador exclui", que existe
 * para proteger REGISTROS do sistema — não para impedir alguém de remover a
 * própria foto de perfil. A rota continua exigindo autenticação, e o serviço só
 * enxerga o `userId` do token (não aceita id de terceiros).
 */
export const DadosProprios = () => SetMetadata(DADOS_PROPRIOS_KEY, true);

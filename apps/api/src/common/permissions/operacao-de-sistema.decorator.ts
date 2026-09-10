import { SetMetadata } from '@nestjs/common';

export const OPERACAO_DE_SISTEMA_KEY = 'operacaoDeSistema';

/**
 * OPERAÇÃO DE SISTEMA — vai além do módulo, e por isso é do Administrador.
 *
 * ESTE DECORADOR EXISTE PARA MATAR O `@Roles` DENTRO DOS MÓDULOS.
 *
 * A matriz de permissões é a promessa do produto: o administrador marca, módulo
 * a módulo, o que cada pessoa vê e edita. Havia uma SEGUNDA política em
 * paralelo — `@Roles(...)` nos controllers — que a matriz não conseguia
 * sobrepor, não aparecia em tela nenhuma e falhava com "Forbidden resource".
 * Eram 4 usos de CLASSE (que atropelavam o módulo inteiro, entre eles
 * `usuarios`) e 68 de rota.
 *
 * O que sobrou aqui são as poucas ações que NÃO são "editar o módulo X" — são
 * ações sobre o SISTEMA, com efeito que não cabe numa linha da matriz:
 *
 *   POST /djen/sincronizar ......... queima a cota do CNJ, do sindicato inteiro
 *   POST /audiencias/reclassificar . reprocessa todo o acervo de uma vez
 *   POST /partes/:id/mesclar ....... funde dois cadastros, sem desfazer
 *
 * SÃO TRÊS, e a lista é curta de propósito. Cheguei a incluir as importações em
 * massa e voltei atrás: importar filiados é EDITAR FILIADOS, com uma tela de
 * conferência antes do `confirmar`. Trancá-las no perfil seria recriar o
 * `@Roles` com um nome mais bonito — exatamente o que este decorador existe
 * para acabar. Quem administra decide isso na matriz, que é onde ele enxerga.
 *
 * A REGRA DE OURO: nível de módulo é decisão de quem administra e vive na
 * matriz; ISTO é decisão do produto e vive aqui, explícito, com mensagem
 * própria e um teste que conta quantos são. Se a lista crescer, o sinal é que
 * ela virou o `@Roles` de novo — e aí o certo é criar um módulo.
 *
 * Não substitui a regra global de DELETE (já no `PermissionsGuard`): apagar
 * registro continua sendo só do Administrador, com ou sem este decorador.
 */
export const OperacaoDeSistema = () => SetMetadata(OPERACAO_DE_SISTEMA_KEY, true);

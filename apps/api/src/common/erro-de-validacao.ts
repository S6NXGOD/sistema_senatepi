import { BadRequestException, Logger, ValidationError } from '@nestjs/common';

/**
 * QUANDO A VALIDAÇÃO ESTÁ FALANDO COM A PESSOA — E QUANDO ESTÁ FALANDO COMIGO.
 *
 * "property enteCodigo should not exist" apareceu na tela de uma secretária em
 * 25/09/2026, ao tentar cadastrar uma organização. Ela não sabe o que é
 * `enteCodigo`, não digitou isso em lugar nenhum, e não há nada que possa
 * fazer: era um defeito NOSSO — o campo existia no DTO do PATCH e faltava no do
 * POST, então **nenhuma organização podia ser cadastrada** havia quinze dias.
 *
 * ## As duas famílias de erro que o pipe produz
 *
 * 1. **O que a PESSOA pode corrigir**: "Informe o nome da parte", "E-mail
 *    inválido", "A nova senha deve ter ao menos 6 caracteres". Essas mensagens
 *    foram escritas para ela e passam inteiras.
 *
 * 2. **O que só um DESENVOLVEDOR pode corrigir**: `should not exist`
 *    (`forbidNonWhitelisted`) e `property X has failed the following
 *    constraints` sem mensagem própria. Isso não é erro de preenchimento — é o
 *    cliente e o servidor discordando sobre o formato. Mostrar o nome do campo
 *    faz a pessoa achar que errou, tentar de novo, tentar de outro jeito, e
 *    finalmente desistir **sem abrir chamado** — que foi exatamente o que
 *    aconteceu por quinze dias.
 *
 * A segunda família vira uma frase que diz a verdade ("é um problema do
 * sistema, avise o suporte") e o detalhe técnico vai INTEIRO para o log, onde
 * serve para alguém consertar.
 *
 * NÃO É ESCONDER ERRO: o log fica mais completo do que a tela estava. O que
 * muda é quem recebe cada metade.
 */

const logger = new Logger('Validacao');

/** As mensagens que o `class-validator` gera sozinho, sem ninguém escrever. */
const SO_PARA_DESENVOLVEDOR = [
  /should not exist$/i,
  /must be a string$/i,
  /must be a number/i,
  /must be an integer/i,
  /must be a boolean/i,
  /must be an array$/i,
  /must be a Date/i,
  /must be one of the following values/i,
  /property .* has failed/i,
];

function ehSoParaDesenvolvedor(mensagem: string): boolean {
  return SO_PARA_DESENVOLVEDOR.some((r) => r.test(mensagem));
}

/** Achata os erros aninhados (`@ValidateNested`) numa lista de mensagens. */
function mensagensDe(erros: ValidationError[], prefixo = ''): string[] {
  return erros.flatMap((e) => {
    const caminho = prefixo ? `${prefixo}.${e.property}` : e.property;
    const proprias = Object.values(e.constraints ?? {});
    const filhos = e.children?.length ? mensagensDe(e.children, caminho) : [];
    return [...proprias, ...filhos];
  });
}

export const MENSAGEM_DE_DEFEITO =
  'Não foi possível salvar: o sistema recusou os dados enviados por esta tela. ' +
  'Isso é um problema nosso, não seu — avise o suporte, que o erro já ficou registrado.';

/**
 * A fábrica de exceção do `ValidationPipe` global.
 *
 * Devolve `message` como ARRAY sempre, porque é o formato que as telas já
 * tratam (`Array.isArray(msg) ? msg[0] : msg`).
 */
export function erroDeValidacao(erros: ValidationError[]): BadRequestException {
  const todas = mensagensDe(erros);
  const daPessoa = todas.filter((m) => !ehSoParaDesenvolvedor(m));

  if (daPessoa.length) return new BadRequestException(daPessoa);

  /*
    NADA QUE A PESSOA POSSA CORRIGIR: o log leva o detalhe inteiro (é o que
    permite achar o campo que falta no DTO em trinta segundos) e a tela leva uma
    frase que não a culpa por um defeito nosso.
  */
  logger.error(`Corpo recusado pelo contrato: ${todas.join(' | ')}`);
  return new BadRequestException([MENSAGEM_DE_DEFEITO]);
}

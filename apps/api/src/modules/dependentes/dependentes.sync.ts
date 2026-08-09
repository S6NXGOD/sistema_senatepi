import { dataCalendario } from '@core/infra';
import { BadRequestException } from '@nestjs/common';
import { Prisma, TipoDependente } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { DependenteRecadastroDto } from '../filiados/dto/filiado.dto';

/**
 * Sincroniza a lista de dependentes junto com a atualização do filiado.
 *
 * Existe para que recadastramento (online e presencial) e edição usem a MESMA
 * regra: o que veio na lista passa a ser a verdade. Sem isso, cada fluxo
 * inventaria a sua e o cadastro divergiria conforme a porta de entrada.
 *
 * Devolve o bloco aninhado do Prisma, aplicado dentro do próprio
 * `filiado.update` — assim tudo entra na mesma transação implícita.
 */
export function montarSincronizacaoDependentes(
  lista: DependenteRecadastroDto[] | undefined,
  atuais: Array<{ id: string }>,
): Prisma.DependenteUpdateManyWithoutFiliadoNestedInput | undefined {
  // Campo ausente = "não mexa nos dependentes". Diferente de lista vazia,
  // que significa "não tenho nenhum".
  if (!lista) return undefined;

  validar(lista);

  const idsAtuais = new Set(atuais.map((d) => d.id));
  // Um id que não pertence a este filiado é ignorado de propósito: impede que
  // alguém adote o dependente de outra pessoa mandando o id na requisição.
  const existentes = lista.filter((d) => d.id && idsAtuais.has(d.id));
  const novos = lista.filter((d) => !d.id || !idsAtuais.has(d.id));
  const mantidos = existentes.map((d) => d.id!) as string[];

  return {
    // Fora da lista = removido pelo titular (uma guarda que mudou, um filho
    // que deixou de ser dependente). Fica registrado no histórico do filiado.
    deleteMany: { id: { notIn: mantidos } },
    update: existentes.map((d) => ({
      where: { id: d.id! },
      data: {
        tipo: d.tipo,
        nome: d.nome.trim(),
        cpf: limparCpf(d.cpf),
        dataNascimento: dataCalendario(d.dataNascimento),
      },
    })),
    create: novos.map((d) => ({
      tipo: d.tipo,
      nome: d.nome.trim(),
      cpf: limparCpf(d.cpf),
      dataNascimento: dataCalendario(d.dataNascimento),
      // Cada dependente tem o próprio QR (carteirinha/presença em eventos).
      qrToken: randomUUID(),
    })),
  };
}

/**
 * Versão para a CRIAÇÃO do filiado: não existe dependente anterior, então só
 * há o que criar (sem `update`/`deleteMany`, que o Prisma nem aceita aqui).
 */
export function montarCriacaoDependentes(
  lista: DependenteRecadastroDto[] | undefined,
): Prisma.DependenteCreateNestedManyWithoutFiliadoInput | undefined {
  if (!lista?.length) return undefined;
  validar(lista);
  return {
    create: lista.map((d) => ({
      tipo: d.tipo,
      nome: d.nome.trim(),
      cpf: limparCpf(d.cpf),
      dataNascimento: dataCalendario(d.dataNascimento),
      qrToken: randomUUID(),
    })),
  };
}

/** Resumo textual da mudança, para o histórico do filiado. */
export function resumirDependentes(
  lista: DependenteRecadastroDto[] | undefined,
  atuais: Array<{ id: string }>,
): string | null {
  if (!lista) return null;
  const idsAtuais = new Set(atuais.map((d) => d.id));
  const mantidos = lista.filter((d) => d.id && idsAtuais.has(d.id)).length;
  const novos = lista.length - mantidos;
  const removidos = atuais.length - mantidos;
  if (!novos && !removidos) return null;

  const partes: string[] = [];
  if (novos) partes.push(`${novos} incluído(s)`);
  if (removidos) partes.push(`${removidos} removido(s)`);
  return `Dependentes: ${partes.join(', ')}.`;
}

function validar(lista: DependenteRecadastroDto[]) {
  // Mesma regra do cadastro avulso de dependentes: só um cônjuge por filiado.
  const conjuges = lista.filter((d) => d.tipo === TipoDependente.CONJUGE).length;
  if (conjuges > 1) {
    throw new BadRequestException('É possível cadastrar apenas um cônjuge.');
  }
  for (const d of lista) {
    if (!d.nome?.trim()) {
      throw new BadRequestException('Informe o nome de todos os dependentes.');
    }
    if (!d.dataNascimento) {
      throw new BadRequestException(
        `Informe a data de nascimento de ${d.nome.trim()}.`,
      );
    }
  }
}

function limparCpf(cpf?: string): string | null {
  const d = (cpf ?? '').replace(/\D/g, '');
  return d.length ? d : null;
}

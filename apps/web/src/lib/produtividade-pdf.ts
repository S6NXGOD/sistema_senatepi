import { tenant } from '@/tenant.config';
import { chaveLocal } from './armazenamento';
import { PERFIL_LABEL } from './permissoes';
import { baixarDocumento, type BlocoDoPdf, type Serie } from './pdf-documento';
import { PALETA, numero, rotulosDosMeses, textoDaComparacao } from './pdf-graficos';
import { presetValido, rotuloDoPeriodo, type Periodo, type PresetDoPeriodo } from './periodo-do-pdf';
import {
  DIAS_PARA_NOTAR_AUSENCIA, GRUPO_DO_PERFIL, O_QUE_NAO_MEDE, TITULO_DO_BLOCO, blocosDaPessoa,
  conteudoDoBloco, diasSemAcesso, faixaDeUso, fraseDoPerfil, textoDoUltimoAcesso,
  type LinhaDeUso, type MesDeUso, type Produtividade,
} from './produtividade';

/**
 * O PDF DO USO DO SISTEMA — "mensal, anual, personalizado, por advogado".
 * Pedido de 12/09/2026.
 *
 * O MESMO RETRATO DA ABA, NO PAPEL, com as mesmas decisões:
 *
 *  · SEM POSIÇÃO. Por perfil e depois por nome, na ordem da API. O gráfico é
 *    do TEMPO (mês a mês), nunca de gente contra gente: barra por pessoa é
 *    pódio desenhado;
 *  · O AVISO ABRE O DOCUMENTO. O que estes números não medem vem antes de
 *    qualquer número, e não é opção — o papel sai da sala sem quem explicaria;
 *  · COMPARA SÓ O QUE É DO PERÍODO. Em aberto e atrasadas são de hoje.
 *
 * O recorte (um perfil, uma pessoa) é feito aqui, sobre a lista que a API já
 * decidiu que quem emite pode ver.
 */

export type QuemNoPdf = 'TODOS' | `PERFIL:${string}` | `PESSOA:${string}`;

/** O detalhe de cada pessoa, quando o PDF é de um grupo. */
export type DetalheDasPessoas = 'TABELA' | 'PAGINAS' | 'NENHUM';

export interface EscolhasDaProdutividade {
  quem: QuemNoPdf;
  detalhe: DetalheDasPessoas;
  graficos: boolean;
}

export interface AnteriorDaProdutividade {
  dados: Produtividade;
  periodo: Periodo;
}

const n = numero;
const perfilDe = (perfil: string) => (PERFIL_LABEL as Record<string, string>)[perfil] ?? perfil;
const mesVazio = (mes: string): MesDeUso => ({ mes, diasComUso: 0, concluidas: 0, andamentos: 0, atendimentos: 0 });
const fimDoMes = (dia: string) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate() === d;
};

export function pessoasDoRecorte(p: Produtividade, quem: QuemNoPdf): LinhaDeUso[] {
  if (p.escopo === 'PESSOAL' || quem === 'TODOS') return p.pessoas;
  if (quem.startsWith('PERFIL:')) {
    const perfil = quem.slice('PERFIL:'.length);
    return p.pessoas.filter((l) => l.perfil === perfil);
  }
  const id = quem.slice('PESSOA:'.length);
  return p.pessoas.filter((l) => l.usuarioId === id);
}

/** O nome do recorte — na capa e no nome do arquivo. */
export function nomeDoRecorte(p: Produtividade, quem: QuemNoPdf): string {
  if (p.escopo === 'PESSOAL') return p.pessoas[0]?.nome ?? 'Uso pessoal';
  if (quem === 'TODOS') return 'Toda a equipe';
  if (quem.startsWith('PERFIL:')) {
    const perfil = quem.slice('PERFIL:'.length);
    return GRUPO_DO_PERFIL[perfil] ?? perfil;
  }
  return pessoasDoRecorte(p, quem)[0]?.nome ?? 'Uma pessoa';
}

/** Mês a mês só quando o período passa de um mês: trinta dias cortados em dois pedaços é ruído. */
function temMesAMes(p: Produtividade, pessoas: LinhaDeUso[]): boolean {
  return (p.meses?.length ?? 0) >= 2 && p.dias.length > 31 && pessoas.every((l) => Array.isArray(l.porMes));
}

/**
 * MÊS A MÊS — o que se registrou em cada mês do período.
 *
 * Série zerada não entra na legenda: "atendimentos: 0" em todos os meses de um
 * advogado é ruído. Embaixo de cada mês, quantas pessoas usaram o sistema nele
 * — ou, na página de uma pessoa, os dias com uso.
 */
function mesAMes(p: Produtividade, pessoas: LinhaDeUso[], graficos: boolean): BlocoDoPdf[] {
  const meses = p.meses ?? [];
  const doMes = (l: LinhaDeUso, mes: string) => l.porMes?.find((m) => m.mes === mes) ?? mesVazio(mes);
  const somar = (f: (m: MesDeUso) => number) =>
    meses.map((mes) => pessoas.reduce((soma, l) => soma + f(doMes(l, mes)), 0));
  const umaSo = pessoas.length === 1;
  const embaixo = meses.map((mes) =>
    umaSo ? doMes(pessoas[0], mes).diasComUso : pessoas.filter((l) => doMes(l, mes).diasComUso > 0).length,
  );
  const todas: (Serie & { valores: number[] })[] = [
    { nome: 'Atividades concluídas', cor: PALETA.verde, valores: somar((m) => m.concluidas) },
    { nome: 'Andamentos internos', cor: PALETA.petroleo, valores: somar((m) => m.andamentos) },
    { nome: 'Atendimentos', cor: PALETA.argila, valores: somar((m) => m.atendimentos) },
  ];
  const rotulos = rotulosDosMeses(meses);
  const primeiro = p.dias[0] ?? '';
  const ultimo = p.dias[p.dias.length - 1] ?? '';
  // Setembro "até o dia 12" desenhado ao lado de agosto inteiro parece queda: a nota avisa.
  const pontas =
    primeiro.endsWith('-01') && ultimo && fimDoMes(ultimo)
      ? ''
      : 'O primeiro e o último mês contam só os dias dentro do período.';

  if (!graficos) {
    return [
      {
        tipo: 'tabela',
        titulo: 'Mês a mês',
        cabecalho: ['Mês', ...todas.map((s) => s.nome), umaSo ? 'Dias com uso' : 'Pessoas que usaram'],
        linhas: meses.map((_, i) => [rotulos[i], ...todas.map((s) => n(s.valores[i])), n(embaixo[i])]),
        numericas: [1, 2, 3, 4],
      },
      ...(pontas ? [{ tipo: 'nota' as const, texto: pontas }] : []),
    ];
  }

  const series = todas.filter((s) => s.valores.some((v) => v > 0));
  if (!series.length) {
    return [{
      tipo: 'colunas', titulo: 'Mês a mês', series: [], categorias: rotulos, valores: [],
      vazio: 'Nada registrado nesses meses.',
    }];
  }
  return [
    {
      tipo: 'colunas',
      titulo: 'Mês a mês',
      series: series.map(({ nome, cor }) => ({ nome, cor })),
      categorias: rotulos,
      valores: series.map((s) => s.valores),
      detalhes: embaixo.map((v) =>
        umaSo ? `${v} ${v === 1 ? 'dia' : 'dias'}` : `${v} ${v === 1 ? 'pessoa' : 'pessoas'}`,
      ),
    },
    {
      tipo: 'nota',
      texto:
        (umaSo
          ? 'Embaixo de cada mês, os dias com uso do sistema.'
          : 'Embaixo de cada mês, quantas pessoas usaram o sistema nele.') + (pontas ? ` ${pontas}` : ''),
    },
  ];
}

/** O que entra no PDF do uso, na ordem em que entra. Nenhum desenho aqui. */
export function planoDaProdutividade(
  p: Produtividade,
  escolhas: EscolhasDaProdutividade,
  anterior?: AnteriorDaProdutividade | null,
): BlocoDoPdf[] {
  // "Agora" é o instante em que a API somou — foi contra ele que ela contou as ausências.
  const agora = new Date(p.geradoEm);
  const pessoas = pessoasDoRecorte(p, escolhas.quem);
  const blocos: BlocoDoPdf[] = [{ tipo: 'destaque', rotulo: 'Antes de ler', texto: O_QUE_NAO_MEDE }];
  if (!pessoas.length) {
    blocos.push({ tipo: 'texto', texto: 'Ninguém neste recorte no período.' });
    return blocos;
  }

  const umaSo = pessoas.length === 1;
  const comMesAMes = temMesAMes(p, pessoas);
  const deAntes = anterior ? pessoasDoRecorte(anterior.dados, escolhas.quem) : null;
  const antesDe = new Map((deAntes ?? []).map((l) => [l.usuarioId, l]));
  const soma = (lista: LinhaDeUso[], f: (l: LinhaDeUso) => number) => lista.reduce((s, l) => s + f(l), 0);

  if (!umaSo) {
    const comparar = (f: (l: LinhaDeUso) => number) =>
      deAntes ? textoDaComparacao(soma(pessoas, f), soma(deAntes, f)) : undefined;
    const usaram = pessoas.filter((l) => l.diasComUso > 0).length;
    const temPublicacoes = soma(pessoas, (l) => l.publicacoes.decididas + l.publicacoes.esperando) > 0;

    blocos.push({ tipo: 'secao', titulo: 'Resumo' });
    blocos.push({
      tipo: 'numeros',
      itens: [
        {
          rotulo: 'Usaram o sistema',
          valor: `${usaram} de ${pessoas.length}`,
          nota: fraseDoPerfil({
            perfil: '',
            pessoas: pessoas.length,
            usaram,
            semAcessoRecente: pessoas.filter(
              (l) => (diasSemAcesso(l.ultimoAcesso, agora) ?? -1) >= DIAS_PARA_NOTAR_AUSENCIA,
            ).length,
            nuncaEntraram: pessoas.filter((l) => !l.ultimoAcesso).length,
          }),
          comparacao: deAntes
            ? `antes ${deAntes.filter((l) => l.diasComUso > 0).length} de ${deAntes.length}`
            : undefined,
        },
        {
          rotulo: 'Atividades concluídas',
          valor: n(soma(pessoas, (l) => l.agenda.concluidas)),
          nota: `${n(soma(pessoas, (l) => l.agenda.noDiaMarcado))} no dia marcado`,
          comparacao: comparar((l) => l.agenda.concluidas),
        },
        {
          rotulo: 'Andamentos internos',
          valor: n(soma(pessoas, (l) => l.processos.andamentos)),
          comparacao: comparar((l) => l.processos.andamentos),
        },
        {
          rotulo: 'Atendimentos registrados',
          valor: n(soma(pessoas, (l) => l.atendimentos)),
          comparacao: comparar((l) => l.atendimentos),
        },
        ...(temPublicacoes
          ? [{
              rotulo: 'Publicações decididas',
              valor: n(soma(pessoas, (l) => l.publicacoes.decididas)),
              comparacao: comparar((l) => l.publicacoes.decididas),
            }]
          : []),
      ],
    });

    if (escolhas.quem === 'TODOS' && p.perfis.length > 1) {
      blocos.push({
        tipo: 'tabela',
        titulo: 'Por perfil',
        cabecalho: ['Perfil', 'Pessoas', 'Usaram', 'Sem entrar há 7 dias ou mais', 'Nunca entraram'],
        linhas: p.perfis.map((r) => [
          GRUPO_DO_PERFIL[r.perfil] ?? r.perfil,
          n(r.pessoas), n(r.usaram), n(r.semAcessoRecente), n(r.nuncaEntraram),
        ]),
        numericas: [1, 2, 3, 4],
      });
    }

    if (comMesAMes) blocos.push(...mesAMes(p, pessoas, escolhas.graficos));

    if (escolhas.detalhe === 'TABELA') {
      blocos.push({
        tipo: 'secao',
        titulo: 'Pessoa por pessoa',
        subtitulo: 'Por perfil e depois por nome — sem posição. Atrasadas são de hoje, e não do período.',
      });
      blocos.push({
        tipo: 'tabela',
        cabecalho: [
          'Pessoa', 'Último acesso', 'Dias com uso', 'Concluídas', 'Atrasadas hoje', 'Andamentos',
          'Atendimentos', 'Publicações decididas',
        ],
        linhas: pessoas.map((l) => [
          `${l.nome}\n${perfilDe(l.perfil)}`,
          l.ultimoAcesso ? textoDoUltimoAcesso(l.ultimoAcesso, agora) : 'nunca entrou',
          `${l.diasComUso} de ${p.dias.length}`,
          n(l.agenda.concluidas),
          n(l.agenda.atrasadas),
          n(l.processos.andamentos),
          n(l.atendimentos),
          n(l.publicacoes.decididas),
        ]),
        numericas: [2, 3, 4, 5, 6, 7],
      });
    }
  }

  if (umaSo || escolhas.detalhe === 'PAGINAS') {
    for (const l of pessoas) {
      const antes = antesDe.get(l.usuarioId);
      blocos.push({
        tipo: 'secao',
        titulo: l.nome,
        subtitulo: `${perfilDe(l.perfil)} · ${
          l.ultimoAcesso ? `último acesso ${textoDoUltimoAcesso(l.ultimoAcesso, agora)}` : 'nunca entrou no sistema'
        }`,
        // No PDF de um grupo, cada pessoa na sua página; o de uma pessoa só começa logo abaixo da capa.
        novaPagina: !umaSo,
      });
      const faixa = faixaDeUso(p.dias, l.diasAtivos);
      blocos.push({
        tipo: 'faixa',
        marcas:
          faixa.tipo === 'DIA'
            ? faixa.marcas.map((m) => ({ intensidade: m.usou ? 1 : 0, fimDeSemana: m.fimDeSemana }))
            : faixa.marcas.map((m) => ({ intensidade: m.diasNoTrecho ? m.diasComUso / m.diasNoTrecho : 0 })),
        legenda: [
          `${l.diasComUso} de ${p.dias.length} ${p.dias.length === 1 ? 'dia' : 'dias'} com uso`,
          ...(antes ? [`antes ${antes.diasComUso}`] : []),
          ...(faixa.tipo === 'SEMANA' ? ['cada traço é uma semana'] : []),
        ].join(' · '),
      });
      blocos.push({
        tipo: 'numeros',
        itens: blocosDaPessoa(l).map((bloco) => {
          const c = conteudoDoBloco(bloco, l);
          return {
            rotulo: `${TITULO_DO_BLOCO[bloco]} · ${c.rotulo}`,
            valor: n(c.numero),
            nota: c.linhas.map((x) => x.texto).join(' · ') || undefined,
            // O número grande de cada quadro é trabalho do período: é só ele que se compara.
            comparacao: antes ? textoDaComparacao(c.numero, conteudoDoBloco(bloco, antes).numero) : undefined,
          };
        }),
      });
      if (comMesAMes) blocos.push(...mesAMes(p, [l], escolhas.graficos));
    }
  }

  blocos.push({
    tipo: 'nota',
    texto:
      '“Dia com uso” é dia com login, sessão renovada ou alguma ação gravada. Em aberto e atrasadas ' +
      'são de hoje, e não do período.' +
      (anterior ? ` “Antes” é ${rotuloDoPeriodo(anterior.periodo)}.` : ''),
  });
  return blocos;
}

/** Período, comparação, gráficos e detalhe da última vez. Quem, título e observação NÃO ficam. */
export interface OpcoesDaProdutividade {
  preset: PresetDoPeriodo;
  comparar: boolean;
  graficos: boolean;
  detalhe: DetalheDasPessoas;
}

export const OPCOES_DA_PRODUTIVIDADE: OpcoesDaProdutividade = {
  preset: 'TELA',
  comparar: true,
  graficos: true,
  detalhe: 'TABELA',
};

const CHAVE_DAS_OPCOES = chaveLocal('relatorio', 'pdf-uso-opcoes');
const DETALHES: DetalheDasPessoas[] = ['TABELA', 'PAGINAS', 'NENHUM'];

export function lerOpcoesDaProdutividade(): OpcoesDaProdutividade {
  const opcoes: OpcoesDaProdutividade = { ...OPCOES_DA_PRODUTIVIDADE };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_DAS_OPCOES) ?? 'null') as
      | Partial<OpcoesDaProdutividade>
      | null;
    if (!salvo || typeof salvo !== 'object') return opcoes;
    if (presetValido(salvo.preset)) opcoes.preset = salvo.preset;
    if (typeof salvo.comparar === 'boolean') opcoes.comparar = salvo.comparar;
    if (typeof salvo.graficos === 'boolean') opcoes.graficos = salvo.graficos;
    if (salvo.detalhe && DETALHES.includes(salvo.detalhe)) opcoes.detalhe = salvo.detalhe;
  } catch {
    // Armazenamento bloqueado ou lixo antigo: vale o padrão.
  }
  return opcoes;
}

export function guardarOpcoesDaProdutividade(opcoes: OpcoesDaProdutividade): void {
  try {
    localStorage.setItem(CHAVE_DAS_OPCOES, JSON.stringify(opcoes));
  } catch {
    // Navegador sem armazenamento: vale só desta vez.
  }
}

/** "Dra. Conceição" vira "dra-conceicao": o acento sai pela decomposição, e não por lista de letras. */
const paraArquivo = (texto: string) =>
  [...texto.normalize('NFD')]
    .filter((c) => c.charCodeAt(0) < 0x300 || c.charCodeAt(0) > 0x36f)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'equipe';

export async function gerarPdfDaProdutividade(
  p: Produtividade,
  escolhas: EscolhasDaProdutividade,
  contexto: { de: string; ate: string; emitidoPor: string; titulo?: string; observacao?: string },
  anterior?: AnteriorDaProdutividade | null,
): Promise<void> {
  const periodo = rotuloDoPeriodo({ de: contexto.de, ate: contexto.ate });
  const recorte = nomeDoRecorte(p, escolhas.quem);
  await baixarDocumento(
    {
      faixa: `Uso do sistema · ${periodo}`,
      titulo:
        contexto.titulo?.trim() || (p.escopo === 'PESSOAL' ? 'O meu uso do sistema' : 'Uso e produtividade'),
      apoio: `Período: ${periodo} · ${recorte} · Emitido por ${contexto.emitidoPor}`,
      observacao: contexto.observacao?.trim() || undefined,
    },
    planoDaProdutividade(p, escolhas, anterior),
    `uso-do-sistema-${tenant.id}-${paraArquivo(recorte)}-${contexto.de}-a-${contexto.ate}.pdf`,
  );
}

import { tenant } from '@/tenant.config';
import { chaveLocal } from './armazenamento';
import { corDasIniciais, iniciaisDe } from './iniciais';
import { PERFIL_LABEL } from './permissoes';
import { baixarDocumento, type BlocoDoPdf, type Serie } from './pdf-documento';
import { PALETA, numero, rotulosDosMeses, textoDaComparacao } from './pdf-graficos';
import {
  periodoPorExtenso, presetValido, rotuloDoPeriodo, type Periodo, type PresetDoPeriodo,
} from './periodo-do-pdf';
import {
  CHAVES_DO_BLOCO, DIAS_PARA_NOTAR_AUSENCIA, GRUPO_DO_PERFIL, NOTA_DAS_DECIDIDAS, O_QUE_NAO_MEDE,
  RETRATO_LABEL, TITULO_DO_BLOCO, blocosDaPessoa, comparaDecididas, conteudoDoBloco, diaEMes, diasDeSemana,
  diasSemAcesso, faixaDeUso, fraseDoPerfil, linhasDaLegenda, textoDoUltimoAcesso, textoDosDiasComUso,
  type ChaveDaLegenda, type LinhaDeUso, type MesDeUso, type Produtividade,
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
  /**
   * Foto do perfil no CARTÃO da pessoa (PDF de uma pessoa ou "uma página por
   * pessoa"). Nunca na tabela "uma linha por pessoa" nem em "só os totais":
   * quinze rostos ao lado de números é mural.
   */
  fotos?: boolean;
}

/** A frase que o "Antes de ler" ganha no PDF, apontando para a legenda do fim. */
export const AVISO_DA_LEGENDA = 'O que cada número conta está no fim do documento.';

/** A chave de leitura da faixa dos dias, conforme o desenho. */
export const CHAVE_DA_FAIXA = {
  DIA: 'cheio = usou · claro = fim de semana',
  SEMANA: 'mais escuro = mais dias com uso na semana',
} as const;

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
  /** As miniaturas da API, por id. Só entram no cartão da pessoa, e só com `escolhas.fotos`. */
  rostos: Record<string, string> = {},
): BlocoDoPdf[] {
  // "Agora" é o instante em que a API somou — foi contra ele que ela contou as ausências.
  const agora = new Date(p.geradoEm);
  const pessoas = pessoasDoRecorte(p, escolhas.quem);
  const aviso: Extract<BlocoDoPdf, { tipo: 'destaque' }> = {
    tipo: 'destaque', rotulo: 'Antes de ler', texto: O_QUE_NAO_MEDE,
  };
  const blocos: BlocoDoPdf[] = [aviso];
  if (!pessoas.length) {
    blocos.push({ tipo: 'texto', texto: 'Ninguém neste recorte no período.' });
    return blocos;
  }

  const umaSo = pessoas.length === 1;
  const comMesAMes = temMesAMes(p, pessoas);
  const deAntes = anterior ? pessoasDoRecorte(anterior.dados, escolhas.quem) : null;
  const antesDe = new Map((deAntes ?? []).map((l) => [l.usuarioId, l]));
  const soma = (lista: LinhaDeUso[], f: (l: LinhaDeUso) => number) => lista.reduce((s, l) => s + f(l), 0);
  /** Os números que este documento mostra: é o que a legenda do fim explica, e nada além. */
  const mostrados = new Set<ChaveDaLegenda>();
  const mostrar = (...chaves: ChaveDaLegenda[]) => chaves.forEach((c) => mostrados.add(c));
  /*
    PUBLICAÇÕES DECIDIDAS SÓ SE COMPARAM DEPOIS DE 13/09/2026 (D19). Antes disso
    ninguém guardava quem aceitou: o "antes" seria um zero que ninguém mediu.
  */
  const comparaAsDecididas = !!anterior && comparaDecididas(anterior.periodo.de);
  let omitiuDecididas = false;

  if (!umaSo) {
    const comparar = (f: (l: LinhaDeUso) => number) =>
      deAntes ? textoDaComparacao(soma(pessoas, f), soma(deAntes, f)) : undefined;
    const usaram = pessoas.filter((l) => l.diasComUso > 0).length;
    const temPublicacoes = soma(pessoas, (l) => l.publicacoes.decididas + l.publicacoes.esperando) > 0;
    const semAcessoRecente = pessoas.filter(
      (l) => (diasSemAcesso(l.ultimoAcesso, agora) ?? -1) >= DIAS_PARA_NOTAR_AUSENCIA,
    ).length;
    const nuncaEntraram = pessoas.filter((l) => !l.ultimoAcesso).length;

    mostrar('usaram', 'concluidas', 'noDiaMarcado', 'andamentos', 'atendimentos');
    if (semAcessoRecente) mostrar('semEntrar');
    if (nuncaEntraram) mostrar('nuncaEntraram');
    if (temPublicacoes) {
      mostrar('decididas');
      if (deAntes && !comparaAsDecididas) omitiuDecididas = true;
    }

    blocos.push({ tipo: 'secao', titulo: 'Resumo' });
    blocos.push({
      tipo: 'numeros',
      itens: [
        {
          rotulo: 'Usaram o sistema',
          valor: `${usaram} de ${pessoas.length}`,
          // Quem sumiu sai em âmbar, como na aba.
          linhas: [{
            texto: fraseDoPerfil({ perfil: '', pessoas: pessoas.length, usaram, semAcessoRecente, nuncaEntraram }),
            alerta: semAcessoRecente + nuncaEntraram > 0,
          }],
          comparacao: deAntes
            ? `antes ${deAntes.filter((l) => l.diasComUso > 0).length} de ${deAntes.length}`
            : undefined,
        },
        {
          rotulo: 'Atividades concluídas',
          valor: n(soma(pessoas, (l) => l.agenda.concluidas)),
          linhas: [{ texto: `${n(soma(pessoas, (l) => l.agenda.noDiaMarcado))} no dia marcado` }],
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
              comparacao: comparaAsDecididas ? comparar((l) => l.publicacoes.decididas) : undefined,
            }]
          : []),
      ],
    });

    if (escolhas.quem === 'TODOS' && p.perfis.length > 1) {
      mostrar('usaram', 'semEntrar', 'nuncaEntraram');
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

    if (comMesAMes) {
      mostrar('mesAMes');
      blocos.push(...mesAMes(p, pessoas, escolhas.graficos));
    }

    if (escolhas.detalhe === 'TABELA') {
      mostrar('ultimoAcesso', 'diasComUso', 'concluidas', 'atrasadas', 'andamentos', 'atendimentos', 'decididas');
      const uteis = diasDeSemana(p.dias);
      blocos.push({
        tipo: 'secao',
        titulo: 'Pessoa por pessoa',
        subtitulo:
          'Por perfil e depois por nome — sem posição. Atrasadas são de hoje, e não do período.' +
          (uteis ? ` O período tem ${uteis} ${uteis === 1 ? 'dia de semana' : 'dias de semana'}.` : ''),
      });
      // Sem foto aqui, de propósito: quinze rostos ao lado de números é mural.
      blocos.push({
        tipo: 'tabela',
        cabecalho: [
          'Pessoa', 'Último acesso', 'Dias com uso', 'Concluídas', 'Atrasadas hoje', 'Andamentos',
          'Atendimentos', 'Publicações decididas',
        ],
        linhas: pessoas.map((l) => [
          `${l.nome}\n${perfilDe(l.perfil)}`,
          l.ultimoAcesso ? textoDoUltimoAcesso(l.ultimoAcesso, agora) : 'nunca entrou',
          n(l.diasComUso),
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
    mostrar('ultimoAcesso', 'diasComUso');
    const primeiro = p.dias[0];
    const ultimo = p.dias[p.dias.length - 1];
    for (const l of pessoas) {
      const antes = antesDe.get(l.usuarioId);
      const cor = corDasIniciais(l.nome, tenant.paleta);
      const foto = escolhas.fotos ? rostos[l.usuarioId] : undefined;
      blocos.push({
        tipo: 'pessoa',
        nome: l.nome,
        linha: `${perfilDe(l.perfil)} · ${
          l.ultimoAcesso ? `último acesso ${textoDoUltimoAcesso(l.ultimoAcesso, agora)}` : 'nunca entrou no sistema'
        }`,
        iniciais: iniciaisDe(l.nome),
        cor: { fundo: cor.fundo, texto: cor.texto },
        ...(foto ? { foto } : {}),
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
          textoDosDiasComUso(l.diasComUso, p.dias),
          ...(antes ? [`antes ${antes.diasComUso}`] : []),
          ...(faixa.tipo === 'SEMANA' ? ['cada traço é uma semana'] : []),
        ].join(' · '),
        ...(primeiro && ultimo ? { inicio: diaEMes(primeiro), fim: diaEMes(ultimo) } : {}),
        chave: CHAVE_DA_FAIXA[faixa.tipo],
      });
      blocos.push({
        tipo: 'numeros',
        // Os três blocos do perfil numa fileira só.
        porFileira: 3,
        itens: blocosDaPessoa(l).map((bloco) => {
          const c = conteudoDoBloco(bloco, l);
          mostrar(...CHAVES_DO_BLOCO[bloco]);
          const semComparacao = bloco === 'publicacoes' && !comparaAsDecididas;
          if (antes && semComparacao) omitiuDecididas = true;
          return {
            grupo: TITULO_DO_BLOCO[bloco],
            rotulo: c.rotulo,
            valor: n(c.numero),
            // Cada frase guarda o próprio alerta: o âmbar da tela chega ao papel.
            linhas: c.linhas,
            // O número grande de cada quadro é trabalho do período: é só ele que se compara.
            comparacao:
              antes && !semComparacao
                ? textoDaComparacao(c.numero, conteudoDoBloco(bloco, antes).numero)
                : undefined,
          };
        }),
      });
      if (comMesAMes) {
        mostrar('mesAMes');
        blocos.push(...mesAMes(p, [l], escolhas.graficos));
      }
    }
  }

  if (anterior) {
    mostrar('antes');
    blocos.push({ tipo: 'nota', texto: `“Antes” é ${rotuloDoPeriodo(anterior.periodo)}.` });
  }
  if (omitiuDecididas) blocos.push({ tipo: 'nota', texto: NOTA_DAS_DECIDIDAS });

  blocos.push(...legendaDoDocumento(mostrados));
  aviso.texto = `${O_QUE_NAO_MEDE} ${AVISO_DA_LEGENDA}`;
  return blocos;
}

/**
 * O QUE CADA NÚMERO CONTA — o último bloco, em três colunas (número, o que
 * conta, retrato), só com os números que ESTE documento mostra. A coluna do
 * retrato faz o trabalho da antiga nota final: diz o que é do período e o que é
 * de hoje.
 */
export function legendaDoDocumento(chaves: Iterable<ChaveDaLegenda>): BlocoDoPdf[] {
  const linhas = linhasDaLegenda(chaves);
  if (!linhas.length) return [];
  return [
    {
      tipo: 'secao',
      titulo: 'O que cada número conta',
      subtitulo: '“Período” é o intervalo escolhido; “Hoje” é o retrato da hora em que o documento foi gerado.',
    },
    {
      tipo: 'tabela',
      cabecalho: ['Número', 'O que conta', 'Retrato'],
      linhas: linhas.map((l) => [l.numero, l.conta, l.retrato ? RETRATO_LABEL[l.retrato] : '']),
      fonte: 7.5,
      larguras: { 0: 34, 2: 16 },
    },
  ];
}

/** Período, comparação, gráficos e detalhe da última vez. Quem, título e observação NÃO ficam. */
export interface OpcoesDaProdutividade {
  preset: PresetDoPeriodo;
  comparar: boolean;
  graficos: boolean;
  detalhe: DetalheDasPessoas;
  /** "Com a foto do perfil" — só vale onde há cartão de pessoa. */
  fotos: boolean;
}

export const OPCOES_DA_PRODUTIVIDADE: OpcoesDaProdutividade = {
  preset: 'TELA',
  comparar: true,
  graficos: true,
  detalhe: 'TABELA',
  fotos: true,
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
    if (typeof salvo.fotos === 'boolean') opcoes.fotos = salvo.fotos;
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
  /** De `carregarRostos()`; vazio quando a opção está desmarcada ou a rota falhou. */
  rostos: Record<string, string> = {},
): Promise<void> {
  const periodo = rotuloDoPeriodo({ de: contexto.de, ate: contexto.ate });
  const recorte = nomeDoRecorte(p, escolhas.quem);
  const emitidoEm = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  await baixarDocumento(
    {
      faixa: `Uso do sistema · ${periodo}`,
      titulo:
        contexto.titulo?.trim() || (p.escopo === 'PESSOAL' ? 'O meu uso do sistema' : 'Uso e produtividade'),
      periodo: periodoPorExtenso({ de: contexto.de, ate: contexto.ate }),
      apoio: `${recorte} · Emitido por ${contexto.emitidoPor} em ${emitidoEm}`,
      observacao: contexto.observacao?.trim() || undefined,
    },
    planoDaProdutividade(p, escolhas, anterior, rostos),
    `uso-do-sistema-${tenant.id}-${paraArquivo(recorte)}-${contexto.de}-a-${contexto.ate}.pdf`,
  );
}

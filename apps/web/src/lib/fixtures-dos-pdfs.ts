/**
 * OS DOIS PDFS QUE NÃO PODEM MUDAR — o do sindicato e o do panorama — num
 * retrato cheio o bastante para passar de uma página. Só para teste.
 *
 * Existem porque a rodada de 14/09/2026 acrescentou blocos em
 * `pdf-documento.ts` para o PDF do uso do sistema, e esses dois documentos usam
 * o mesmo desenho: o teste de `paginas-dos-pdfs.spec.ts` gera os dois com o
 * jsPDF real e confere o número de páginas. Nomes inventados.
 */
import type { Concentracao, Dispersao, Historico, Panorama } from './panorama';
import type { EscolhasDoPanorama } from './panorama-pdf';
import { ESCOLHAS_PADRAO, type EscolhasDoPdf, type RotulosDoPdf } from './relatorio-pdf';
import type { Relatorio } from './relatorios';

export const ROTULOS_DE_TESTE: RotulosDoPdf = {
  tipo: (s) => s, area: (s) => s, canal: (s) => s, assunto: (s) => s, setor: (s) => s,
  motivoDesfiliacao: (s) => s,
};

export const RELATORIO_TUDO_DETALHADO = Object.fromEntries(
  Object.keys(ESCOLHAS_PADRAO).map((k) => [k, { incluir: true, detalhar: true }]),
) as EscolhasDoPdf;

const contagens = (prefixo: string, quantas: number) =>
  Array.from({ length: quantas }, (_, i) => ({ rotulo: `${prefixo} ${i + 1}`, total: quantas * 3 - i * 2 }));

export function relatorioCheio(ajuste = 0): Relatorio {
  return {
    periodo: { de: '2026-08-13T03:00:00.000Z', ate: '2026-09-13T03:00:00.000Z' },
    escopo: 'GLOBAL',
    focoUsuario: null,
    equipe: Array.from({ length: 14 }, (_, i) => ({
      usuarioId: `u${i}`, nome: `Pessoa ${i + 1}`, papel: i % 3 ? 'ADVOGADO' : 'TRIAGEM',
      concluidas: 12 + i + ajuste, abertas: 3, atrasadas: i % 4, medianaMinutos: i % 2 ? 20 : null, cronometradas: 4,
    })),
    atividades: {
      concluidas: 120 + ajuste, canceladas: 12, abertas: 45, atrasadas: 13,
      porDesfecho: contagens('Desfecho', 5), porTipo: contagens('TIPO', 7), automaticas: 40, manuais: 80,
    },
    processos: {
      cadastrados: 35 + ajuste, distribuidos: 11, ativos: 149, encerrados: 29, semDataDeDistribuicao: 1,
      porArea: contagens('Área', 6), porTribunal: contagens('Tribunal', 4),
    },
    atendimentos: {
      registrados: 90 + ajuste, concluidos: 70, filiadosAtendidos: 64, porCanal: contagens('Canal', 4),
      porAtendente: contagens('Atendente', 5), porAssunto: contagens('Assunto', 9), assuntoNaoInformado: 6,
      outrosAssuntos: [{ texto: 'aposentadoria', total: 4 }], outrosUnicos: 3, porSetor: contagens('Setor', 6),
    },
    justica: {
      nossoPapel: { autor: 117, representando: 26, reu: 6 },
      institucionais: 117,
      individuais: 32,
      sentencasPorAno: [
        { ano: 2024, procedentes: 7, parciais: 11, improcedentes: 3 },
        { ano: 2025, procedentes: 9, parciais: 20, improcedentes: 5 },
        { ano: 2026, procedentes: 6, parciais: 13, improcedentes: 8 },
      ],
      ajuizadasPorAno: [
        { ano: 2024, processos: 31 },
        { ano: 2025, processos: 40 },
        { ano: 2026, processos: 36 },
      ],
      sentencasNoPeriodo: Array.from({ length: 6 }, (_, i) => ({
        processoId: `p${i}`, numeroCNJ: `080${i}123-45.2026.8.18.0140`, adversario: `Município ${i + 1}`,
        resultado: i % 2 ? 'PROCEDENTE' : 'PARCIAL', data: `2026-09-0${i + 1}`,
      })),
      totalSentencasNoPeriodo: 6,
      adversarios: contagens('Estado', 15).map((c, i) => ({ ...c, chave: `a${i}` })),
      comarcas: contagens('Comarca', 10).map((c, i) => ({ ...c, chave: `22110${i}` })),
      temas: contagens('Tema', 10),
    },
    proximos: {
      dias: 30,
      audiencias: Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`, titulo: `Audiência ${i + 1}`, tipo: 'AUDIENCIA', inicio: `2026-09-1${i + 5}T12:00:00.000Z`,
        processo: { id: `p${i}`, numeroCNJ: `080${i}123-45.2026.8.18.0140` },
        responsavel: { id: 'u1', nome: 'Pessoa 2', nomeExibicao: null, avatarUrl: null },
      })),
      totalAudiencias: 5,
      prazos: Array.from({ length: 8 }, (_, i) => ({
        id: `z${i}`, titulo: `Prazo ${i + 1}`, tipo: 'PRAZO', inicio: `2026-09-2${i}T12:00:00.000Z`,
        processo: null, responsavel: null,
      })),
      totalPrazos: 8,
    },
    publicacoes: { recebidas: 102 + ajuste, viraramTarefa: 28, dispensadas: 66, esperandoDecisao: 7 },
    robo: { criadas: 39, concluidas: 15, canceladasPeloRobo: 14, canceladasPorPessoas: 2, abertas: 8 },
    geradoEm: '2026-09-14T12:00:00.000Z',
  };
}

const historico = (h: Partial<Historico> = {}): Historico => ({
  julgados: 5, procedentes: 2, parciais: 2, improcedentes: 1, comRecursoDepois: 0, ...h,
});

const concentracao = (c: Partial<Concentracao> = {}): Concentracao => ({
  parteExternaId: 'pe-1',
  adversario: 'Hapvida Assistência Médica',
  tipo: 'JURIDICA',
  processos: 5,
  individuais: 4,
  desde: '2021-03-01',
  julgados: 3, procedentes: 1, parciais: 2, improcedentes: 0,
  pedidos: [{ assunto: 'Indenização Relacionada ao Exercício do Direito de Greve', processos: 3 }],
  historico: historico(),
  leituras: ['COLETIVA_POSSIVEL'],
  ...c,
});

const dispersao = (d: Partial<Dispersao> = {}): Dispersao => ({
  assunto: 'Piso Salarial da Categoria',
  processos: 9,
  adversarios: 6,
  individuais: 2,
  desde: '2022-01-10',
  julgados: 4, procedentes: 2, parciais: 1, improcedentes: 1,
  historico: historico({ julgados: 7, procedentes: 3, parciais: 2, improcedentes: 2 }),
  porAno: [
    { ano: 2022, processos: 1 },
    { ano: 2023, processos: 1 },
    { ano: 2024, processos: 0 },
    { ano: 2025, processos: 5 },
    { ano: 2026, processos: 2 },
  ],
  ...d,
});

export function panoramaCheio(): Panorama {
  return {
    concentracoes: Array.from({ length: 22 }, (_, i) =>
      concentracao({ parteExternaId: `pe-${i}`, adversario: `Empresa ${i}`, tipo: i % 5 ? 'JURIDICA' : 'FISICA' }),
    ),
    dispersoes: Array.from({ length: 10 }, (_, i) =>
      dispersao({ assunto: `Assunto ${i}`, porAno: i === 3 ? [] : dispersao().porAno }),
    ),
    nossoPapel: { autor: 93, reu: 3, representando: 31 },
    acervoAtivo: 149,
    geradoEm: '2026-09-13T01:30:00.000Z',
  };
}

export const PANORAMA_TUDO_DETALHADO: EscolhasDoPanorama = {
  lados: { incluir: true, detalhar: true },
  concentracoes: { incluir: true, detalhar: true },
  dispersoes: { incluir: true, detalhar: true },
};

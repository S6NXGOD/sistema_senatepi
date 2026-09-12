import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ausente, blocosDaPessoa, conteudoDoBloco, faixaDeUso, fraseDoPerfil, gruposPorPerfil,
  hrefDaAuditoria, textoDoUltimoAcesso, type LinhaDeUso,
} from './produtividade';

const ler = (relativo: string) => readFileSync(join(__dirname, '..', relativo), 'utf8');

const linha = (over: Partial<LinhaDeUso> = {}): LinhaDeUso => ({
  usuarioId: 'u', nome: 'Pessoa', perfil: 'ADVOGADO', avatarUrl: null, avatarKey: null,
  ultimoAcesso: null, diasComUso: 0, diasAtivos: [],
  agenda: { concluidas: 0, noDiaMarcado: 0, criadas: 0, abertas: 0, atrasadas: 0 },
  publicacoes: { decididas: 0, esperando: 0 },
  processos: { cadastrados: 0, andamentos: 0, documentos: 0 },
  filiados: { cadastrados: 0, fichasAtualizadas: 0 },
  atendimentos: 0,
  ...over,
});

/**
 * "UMA PARTE PARA RELATÓRIOS FOCADA EM PRODUTIVIDADE, POR USUÁRIO E POR PERFIL"
 * — pedido de 12/09/2026. Os nomes de pessoas aqui são inventados.
 */
describe('uso e produtividade — o que a tela diz', () => {
  // Um sábado em Teresina, às 15h (o jest roda no fuso de Fortaleza).
  const agora = new Date('2026-09-12T15:00:00-03:00');

  it('último acesso em frase de gente, pelo calendário', () => {
    expect(textoDoUltimoAcesso('2026-09-12T09:05:00-03:00', agora)).toBe('hoje às 09:05');
    expect(textoDoUltimoAcesso('2026-09-11T23:00:00-03:00', agora)).toBe('ontem');
    expect(textoDoUltimoAcesso('2026-09-07T10:00:00-03:00', agora)).toBe('há 5 dias');
    expect(textoDoUltimoAcesso('2026-08-20T10:00:00-03:00', agora)).toBe('há 3 semanas');
    expect(textoDoUltimoAcesso('2026-07-04T10:00:00-03:00', agora)).toBe('em 04/07/2026');
  });

  it('ausência é o mesmo corte da API: nunca entrou, ou sete dias sem entrar', () => {
    expect(ausente(null, agora)).toBe(true);
    expect(ausente('2026-09-05T15:00:00-03:00', agora)).toBe(true);
    expect(ausente('2026-09-06T15:00:00-03:00', agora)).toBe(false);
  });

  it('a faixa é por dia até dois meses, e o fim de semana é marcado', () => {
    expect(faixaDeUso(['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'], ['2026-09-07'])).toEqual({
      tipo: 'DIA',
      marcas: [
        { dia: '2026-09-04', usou: false, fimDeSemana: false },
        { dia: '2026-09-05', usou: false, fimDeSemana: true },
        { dia: '2026-09-06', usou: false, fimDeSemana: true },
        { dia: '2026-09-07', usou: true, fimDeSemana: false },
      ],
    });
  });

  it('acima de dois meses, a faixa vira semanas', () => {
    const dias = Array.from({ length: 70 }, (_, i) =>
      new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
    );
    const faixa = faixaDeUso(dias, [dias[0], dias[1], dias[69]]);
    expect(faixa.tipo).toBe('SEMANA');
    expect(faixa.marcas).toHaveLength(10);
    expect(faixa.marcas[0]).toEqual({ inicio: '2026-07-01', diasComUso: 2, diasNoTrecho: 7 });
    expect(faixa.marcas[9]).toEqual({ inicio: dias[63], diasComUso: 1, diasNoTrecho: 7 });
  });

  /** O perfil decide a ORDEM dos blocos; o que foi registrado nunca some. */
  it('o perfil ordena os blocos, mas não esconde trabalho registrado', () => {
    expect(blocosDaPessoa(linha())).toEqual(['agenda', 'publicacoes', 'processos']);
    expect(blocosDaPessoa(linha({ atendimentos: 3 }))).toEqual([
      'agenda', 'publicacoes', 'processos', 'atendimentos',
    ]);
    expect(blocosDaPessoa(linha({ perfil: 'TRIAGEM' }))[0]).toBe('atendimentos');
  });

  /** "Atrasada", nunca "prazo vencido" — e só o atraso ganha cor. */
  it('o bloco da agenda diz o atraso, e só ele pede atenção', () => {
    const c = conteudoDoBloco(
      'agenda',
      linha({ agenda: { concluidas: 12, noDiaMarcado: 9, criadas: 4, abertas: 3, atrasadas: 1 } }),
    );
    expect(c.numero).toBe(12);
    expect(c.linhas).toEqual([
      { texto: '9 no dia marcado' },
      { texto: '3 em aberto, 1 atrasada', alerta: true },
      { texto: 'criou 4' },
    ]);
    expect(JSON.stringify(conteudoDoBloco('agenda', linha()))).not.toContain('vencid');
  });

  it('publicação esperando decisão pede atenção; nenhuma, não', () => {
    expect(conteudoDoBloco('publicacoes', linha({ publicacoes: { decididas: 8, esperando: 2 } })).linhas).toEqual([
      { texto: '2 esperando decisão', alerta: true },
    ]);
    expect(conteudoDoBloco('publicacoes', linha()).linhas).toEqual([{ texto: 'nenhuma esperando' }]);
  });

  it('o resumo do perfil diz quem sumiu — ou que ninguém sumiu', () => {
    expect(
      fraseDoPerfil({ perfil: 'ADVOGADO', pessoas: 9, usaram: 7, semAcessoRecente: 1, nuncaEntraram: 2 }),
    ).toBe('1 sem entrar há uma semana ou mais · 2 nunca entraram');
    expect(
      fraseDoPerfil({ perfil: 'TRIAGEM', pessoas: 2, usaram: 2, semAcessoRecente: 0, nuncaEntraram: 0 }),
    ).toBe('todos entraram na última semana');
  });

  it('agrupa por perfil sem reordenar as pessoas', () => {
    const grupos = gruposPorPerfil([
      linha({ usuarioId: '1', nome: 'Ana' }),
      linha({ usuarioId: '2', nome: 'Bia' }),
      linha({ usuarioId: '3', nome: 'Caio', perfil: 'TRIAGEM' }),
    ]);
    expect(grupos.map((g) => [g.perfil, g.pessoas.map((p) => p.nome)])).toEqual([
      ['ADVOGADO', ['Ana', 'Bia']],
      ['TRIAGEM', ['Caio']],
    ]);
  });
});

describe('uso e produtividade — onde mora', () => {
  it('"ver o que fez" abre a auditoria com a pessoa e o período, e a auditoria lê', () => {
    expect(hrefDaAuditoria('u 1', '2026-08-13', '2026-09-12')).toBe(
      '/auditoria?usuario=u%201&de=2026-08-13&ate=2026-09-12',
    );
    const AUDITORIA = ler('app/(dashboard)/auditoria/page.tsx');
    expect(AUDITORIA).toMatch(/useFiltroPorUrl\(\s*'usuario',/);
    expect(AUDITORIA).toMatch(/useFiltroPorUrl\(\s*'de',/);
    expect(AUDITORIA).toMatch(/useFiltroPorUrl\(\s*'ate',/);
    expect(AUDITORIA).toContain('<Suspense');
  });

  it('é uma aba dos relatórios, e a planilha segue a aba', () => {
    const TELA = ler('app/(dashboard)/relatorios/page.tsx');
    expect(TELA).toContain("{aba === 'uso' && <UsoEProdutividade de={de} ate={ate} />}");
    expect(TELA).toContain("if (aba === 'uso') await baixarCsvDaProdutividade(de, ate);");
    expect(TELA).toContain("enabled: aba === 'sindicato',");
  });

  /** Sem medalha: a tela não reordena o que a API mandou, e diz o que o número não mede. */
  it('o componente não ordena, e leva a ressalva e a porta da auditoria', () => {
    const COMPONENTE = ler('components/relatorios/uso-e-produtividade.tsx');
    expect(COMPONENTE).not.toMatch(/\.sort\(/);
    expect(COMPONENTE).toContain('{O_QUE_NAO_MEDE}');
    expect(COMPONENTE).toContain("podeVer(user?.role, user?.permissoes, 'auditoria')");
  });
});

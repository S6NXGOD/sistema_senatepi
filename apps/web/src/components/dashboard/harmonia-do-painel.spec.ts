import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { atalhosDe } from './atalhos-do-perfil';
import { lerUrlDaAgenda } from '@/lib/agenda';

/**
 * O PAINEL E AS TELAS VIZINHAS CONTAM E ABREM A MESMA COISA — revisão de 13/09/2026.
 *
 * As regras moram em funções puras de `lib/dashboard.ts` (testadas com valores
 * em `lib/dashboard.spec.ts`). Aqui se confere que as telas USAM essas funções,
 * lendo o fonte SEM comentários: um comentário que cite o código não pode deixar
 * o teste verde.
 */

const RAIZ = path.resolve(__dirname, '../..');
function semComentarios(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
const ler = (rel: string) => semComentarios(readFileSync(path.join(RAIZ, rel), 'utf8'));

function abrir(href: string, meuId = 'eu-mesma') {
  const [rota, query = ''] = href.split('?');
  return { rota, ...lerUrlDaAgenda(new URLSearchParams(query), meuId) };
}

describe('os atalhos abrem o que o rótulo diz', () => {
  const doPerfil = (role: string, label: string) => {
    const a = atalhosDe(role).find((x) => x.label === label);
    if (!a) throw new Error(`atalho "${label}" sumiu de ${role}`);
    return abrir(a.href);
  };

  it('"Meus prazos (7 dias)" do advogado: só prazo, só da pessoa', () => {
    expect(doPerfil('ADVOGADO', 'Meus prazos (7 dias)')).toMatchObject({
      rota: '/agenda', aba: '7dias', tipo: 'PRAZO', pessoa: 'eu-mesma',
    });
  });

  it('"Prazos em aberto" da gestão: só prazo, da casa', () => {
    for (const role of ['COORDENACAO', 'ADMINISTRADOR']) {
      const e = doPerfil(role, 'Prazos em aberto');
      expect(e).toMatchObject({ rota: '/agenda', aba: 'aberto', tipo: 'PRAZO' });
      expect(e.pessoa).toBeUndefined();
    }
  });
});

describe('as telas usam as regras', () => {
  const PAINEL = ler('app/(dashboard)/dashboard/page.tsx');
  const ATIVIDADES = ler('components/dashboard/atividades-do-dia.tsx');
  const AGENDA = ler('app/(dashboard)/agenda/page.tsx');
  const FICHA = ler('components/processos/processo-detalhe-sheet.tsx');

  it('o cartão de prazos leva o escopo do painel', () => {
    expect(PAINEL).toContain('href: linkDosPrazosDaSemana(data.escopo),');
    expect(PAINEL).not.toContain("href: linkDaAgenda({ aba: '7dias', tipo: 'PRAZO' }),");
  });

  it('o selo das audiências é o total, nunca o tamanho da lista', () => {
    const ini = PAINEL.indexOf('function AudienciasSemana(');
    expect(ini).toBeGreaterThan(-1);
    const bloco = PAINEL.slice(ini, PAINEL.indexOf('</SectionCard>', ini));
    expect(bloco).toContain('count={seloDasAudienciasDaSemana(data)}');
    expect(bloco).not.toContain('count={itens.length}');
  });

  it('o rodapé das atividades escreve pela regra', () => {
    expect(ATIVIDADES).toContain('{textoDoRodapeDasAtividades({ ocultas, atencaoOculta, pessoal })}');
    expect(ATIVIDADES).not.toContain("Mais {ocultas} {pessoal ? 'na agenda' : 'da equipe na agenda'}");
  });

  it('a agenda invalida as mesmas chaves do painel ao concluir', () => {
    const concluido = AGENDA.slice(AGENDA.indexOf('onConcluido={(caso) => {'));
    expect(concluido.slice(0, 200)).toContain(
      'for (const k of CHAVES_DEPOIS_DE_CONCLUIR) qc.invalidateQueries({ queryKey: k });',
    );
  });

  it('a ficha do processo recadastra pelo modal das duas portas', () => {
    expect(FICHA).toContain('<RecadastrarModal');
    expect(FICHA).toContain('semNavegar');
    expect(FICHA).toContain('onRecadastrarPresencial={(id) => {');
    expect(FICHA).toContain('setPresencial(id);');
    expect(FICHA).toContain('open={!!presencial}');
  });

  it('a ficha só troca o conteúdo pela tela de erro quando não há dado', () => {
    expect(FICHA).toContain('{falhouDossie && !p ? (');
    expect(FICHA).not.toContain('{falhouDossie ? (');
  });
});

/**
 * O ROTULO DO CARTAO QUEBRA, NAO CORTA (18/09/2026).
 *
 * Conferido no telefone de 400 px, na home da Triagem: tres cartoes em
 * `grid-cols-3` deixam ~110 px cada, e o icone a direita come mais 48. Com
 * `truncate`, "Registrei hoje" virava "REGI...", "Com a triagem" virava "CO..."
 * e "cadastros novos" virava "cada...". Cartao cujo rotulo nao se le nao vale a
 * area que ocupa.
 */
describe('o rótulo do KpiCard cabe no telefone', () => {
  const WIDGETS = readFileSync(path.join(__dirname, 'widgets.tsx'), 'utf8');
  const PAINEL = readFileSync(
    path.join(__dirname, '../../app/(dashboard)/dashboard/page.tsx'), 'utf8',
  );

  it('o rótulo quebra em duas linhas em vez de cortar', () => {
    const bloco = WIDGETS.slice(WIDGETS.indexOf('O RÓTULO QUEBRA, NÃO CORTA'));
    const trecho = bloco.slice(0, 1800);
    expect(trecho).toContain('line-clamp-2');
    expect(trecho).not.toContain('truncate text-[11px] font-medium uppercase');
  });

  it('a legenda de baixo também', () => {
    expect(WIDGETS).toContain('mt-2 line-clamp-2 text-[11px] leading-tight');
  });

  /** Duas linhas, e não sem limite: o cartão continua com altura previsível. */
  it('o limite continua existindo', () => {
    expect(WIDGETS).not.toContain('line-clamp-none');
  });

  /**
   * DUAS LINHAS SOZINHAS NÃO RESOLVIAM: com o ícone ao lado sobravam ~40 px
   * para a palavra. O ícone é decoração; o número é o dado e o rótulo o explica.
   * Medido depois: ZERO rótulos cortados nos dois perfis, a 400 px.
   */
  it('o ícone cede a vez no telefone e volta no tablet', () => {
    expect(WIDGETS).toContain("'hidden rounded-xl p-2 sm:inline-flex sm:p-2.5'");
  });

  /** A carteira do advogado já usava `gap-2` no telefone; o balcão, não. */
  it('o balcão da triagem usa o mesmo espaçamento da carteira', () => {
    expect(PAINEL).toContain("grid grid-cols-3 gap-2 sm:gap-4");
    expect(PAINEL).not.toContain('grid grid-cols-3 gap-4');
  });
});

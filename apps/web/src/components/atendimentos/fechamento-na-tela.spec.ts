import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// O hook só pede o QueryClient: com um cliente falso, dá para chamá-lo fora do
// React e ver as chaves de verdade. O prefixo `mock` é o que o jest deixa usar
// dentro da fábrica içada.
const mockInvalidadas: unknown[] = [];
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: (f: { queryKey: unknown }) => mockInvalidadas.push(f.queryKey) }),
}));
import { useInvalidarAtendimentoEAgenda } from './fechar-atendimento-modal';

/*
  FECHAR O ATENDIMENTO: travas de montagem (14/09/2026).

  O comportamento (plano, recusas, corpos, frases) tem teste com valores em
  lib/atendimentos.spec.ts. Aqui ficam só as decisões de montagem que não cabem
  numa função pura. Todas miram CÓDIGO: os comentários são retirados antes,
  porque a explicação em português cita as mesmas palavras.
*/
const ler = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const semComentarios = (fonte: string) =>
  fonte
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
const codigo = (rel: string) => semComentarios(ler(rel));

const LIB = codigo('lib/atendimentos.ts');
const PAGINA = codigo('app/(dashboard)/atendimentos/page.tsx');
const GAVETA = codigo('components/atendimentos/atendimento-drawer.tsx');
const MODAL = codigo('components/atendimentos/fechar-atendimento-modal.tsx');
const DESFECHO = codigo('components/atendimentos/registrar-desfecho-modal.tsx');

/*
  14/09/2026: aberta pela agenda, a gaveta salvava "Por vídeo" e o cartão da
  agenda continuava "Na sede", porque só a chave do atendimento era invalidada.
*/
describe('mexer na consulta pelo atendimento atualiza a agenda', () => {
  it('a lista de chaves alcança a agenda, a gaveta da atividade e as pendências', () => {
    mockInvalidadas.length = 0;
    useInvalidarAtendimentoEAgenda()('at-14');
    expect(mockInvalidadas).toEqual([
      ['atendimentos'], ['atendimento', 'at-14'], ['dashboard-resumo'],
      ['compromissos'], ['compromisso'], ['minhas-pendencias'],
    ]);
  });

  it('mudar a modalidade pela gaveta usa essa lista, com o id do atendimento', () => {
    const salvar = GAVETA.slice(GAVETA.indexOf('mudarModalidadeDaConsulta(atendimentoId'), GAVETA.indexOf('function avisarPeloWhatsApp'));
    expect(GAVETA).toContain('const invalidarComAAgenda = useInvalidarAtendimentoEAgenda();');
    expect(salvar).toContain('invalidarComAAgenda(atendimentoId);');
  });

  it('o desfecho (que pode marcar consulta) usa a mesma lista', () => {
    expect(DESFECHO).toContain('const invalidar = useInvalidarAtendimentoEAgenda();');
    const onSuccess = DESFECHO.slice(DESFECHO.indexOf('onSuccess: (r) =>'), DESFECHO.indexOf('function submeter'));
    expect(onSuccess).toContain('invalidar(a.id);');
    expect(DESFECHO).not.toContain('useQueryClient');
  });
});

describe('concluir e cancelar não passam mais pelo /status', () => {
  /*
    O #9 foi de cancelado a concluído seis vezes em quatro minutos (02/09) pelo
    PATCH de status. Na janela de troca, o web novo contra a API antiga NÃO pode
    cair nele como atalho: isso reabriria a porta sem motivo.
  */
  it('o único PATCH do /status na lib é o Reabrir, com PENDENTE fixo', () => {
    const usos = LIB.match(/\/status`/g) ?? [];
    expect(usos).toHaveLength(1);
    expect(LIB).toContain("api.patch(`/atendimentos/${id}/status`, { status: 'PENDENTE' })");
    expect(LIB).toContain('api.patch(`/atendimentos/${id}/concluir`, dto)');
    expect(LIB).toContain('api.patch(`/atendimentos/${id}/cancelar`, dto)');
    expect(LIB).toContain('api.patch(`/atendimentos/${id}/consultas/${compromissoId}/modalidade`, dto)');
  });

  it.each([['página', PAGINA], ['gaveta', GAVETA], ['modal', MODAL]])('%s não chama a função antiga de status', (_n, fonte) => {
    expect(fonte).not.toContain('mudarStatusAtendimento');
    expect(fonte).not.toMatch(/mutate\(\s*'(CONCLUIDO|CANCELADO|PENDENTE)'/);
  });

  it('a lista e a gaveta abrem o MESMO modal e o mesmo Reabrir', () => {
    for (const fonte of [PAGINA, GAVETA]) {
      expect(fonte).toContain('<FecharAtendimentoModal');
      expect(fonte).toContain('<ReabrirAtendimentoDialog');
    }
  });
});

describe('concluído não vira cancelado sem reabrir', () => {
  it('na gaveta e no menu, "Cancelar atendimento" só aparece com o atendimento pendente', () => {
    // O rodapé da gaveta: guarda de pendente, e fora do caso da consulta de pé.
    const rodape = GAVETA.slice(0, GAVETA.lastIndexOf("setFechar('CANCELAR')"));
    expect(rodape.slice(rodape.lastIndexOf('{at.status'))).toMatch(/^\{at\.status === 'PENDENTE' && !consultaDePe && \(/);
    // O bloco da consulta de pé só existe nos modos que exigem pendente (valores em lib/atendimentos.spec.ts).
    const bloco = GAVETA.slice(0, GAVETA.indexOf("onCancelar={() => setFechar('CANCELAR')}"));
    expect(bloco.slice(bloco.lastIndexOf('{at.encaminhamento &&'))).toMatch(/^\{at\.encaminhamento && consultaDePe && \(/);
    expect(GAVETA).toContain("const consultaDePe = modo === 'FECHA_SOZINHO' || modo === 'CONSULTA_SEM_REGISTRO';");
    const pagina = PAGINA.slice(0, PAGINA.indexOf("acao: 'CANCELAR'"));
    expect(pagina.slice(pagina.lastIndexOf('{menu.a.status'))).toMatch(/^\{menu\.a\.status === 'PENDENTE' && \(/);
  });
});

/*
  O ATENDIMENTO INDEPENDENTE NA TELA (15/09/2026). As regras têm teste com
  valores em lib/atendimentos.spec.ts; aqui, só a montagem.
*/
describe('a triagem não responde mais pelo advogado', () => {
  it('o modal não tem mais o grupo "o que houve com a consulta?"', () => {
    expect(MODAL).not.toContain("onConsulta('MANTER')");
    expect(MODAL).not.toContain('titulo="A consulta aconteceu"');
    expect(MODAL).toContain('tituloDoConcluir(caso, at?.numero)');
  });

  it('com a consulta de pé, a gaveta não oferece botão sólido de concluir', () => {
    const ini = GAVETA.indexOf('function EsperaPelaConsulta(');
    const bloco = GAVETA.slice(ini, GAVETA.indexOf('function AvisoDaRemarcada(', ini));
    expect(bloco).toContain('Resolvido sem a consulta');
    expect((bloco.match(/<Button\b/g) ?? []).length).toBe((bloco.match(/<Button\s+variant="outline"/g) ?? []).length);
    // O Concluir do rodapé só na vez da triagem, ou na gaveta de antes.
    expect(GAVETA).toContain("(modo === 'CONCLUIR' || (modo === 'OUTRO' && at.desfecho && at.status === 'PENDENTE' && !faltaConcluir(at)))");
  });

  it('a lista filtra pela fila e a chave da consulta acompanha o filtro', () => {
    expect(PAGINA).toContain('filtroDoSeletorDeStatus(e.target.value as ValorDoSeletorDeStatus)');
    // 15/09/2026: o "Só os meus" (`atendente`) entrou no filtro, então entra na chave e na volta à página 1.
    expect(PAGINA).toContain("queryKey: ['atendimentos', buscaDeb, status, fila, desfecho, canal, assunto, dataInicio, dataFim, atendente, page]");
    expect(PAGINA).toContain('useEffect(() => { setPage(1); }, [status, fila, desfecho, canal, assunto, dataInicio, dataFim, atendente]);');
    expect(PAGINA).toContain('fila: fila || undefined');
  });
});

describe('o modal a 400 px', () => {
  it('cancelar é âmbar escuro, nunca vermelho: o vermelho é só do Excluir', () => {
    expect(MODAL).toContain("'bg-amber-700 text-white hover:bg-amber-800'");
    expect(MODAL).not.toContain('variant="destructive"');
    expect(MODAL).not.toMatch(/\bred-\d/);
  });

  it('folha de baixo, rodapé com Voltar antes do principal e respiro do iPhone', () => {
    expect(MODAL).toContain('items-end justify-center');
    expect(MODAL).toContain('max-h-[92vh]');
    expect(MODAL).toContain('rounded-t-2xl');
    expect(MODAL).toContain('flex flex-col-reverse gap-2');
    expect(MODAL).toContain("paddingBottom: 'max(12px, env(safe-area-inset-bottom))'");
  });

  it('sem autofoco (o teclado cobriria o bloco âmbar) e textarea sem zoom no iOS', () => {
    expect(MODAL).not.toContain('autoFocus');
    expect(MODAL).toContain('min-h-24');
    expect(MODAL).toContain('text-base md:text-sm');
  });

  it('com o formulário sujo, toque fora e Esc não fecham', () => {
    expect(MODAL).toContain('const fecharPorFora = !salvando && (!sujo || !!confirmado);');
    expect(MODAL).toContain('onClick={fecharPorFora ? onClose : undefined}');
    expect(MODAL).toContain('if (fecharPorFora) onClose();');
  });

  it('em todo erro, o detalhe é buscado de novo: o plano pode ter mudado', () => {
    const onError = MODAL.slice(MODAL.indexOf('onError: (e: any) =>'), MODAL.indexOf('const salvando'));
    expect(onError).toContain('refetch();');
  });
});

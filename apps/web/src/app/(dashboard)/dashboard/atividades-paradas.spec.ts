import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAINEL = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const TIPO = readFileSync(join(__dirname, '../../../lib/dashboard.ts'), 'utf8');

/** O componente é o último do arquivo; daqui até o fim é só ele. */
const FAIXA = PAINEL.slice(PAINEL.indexOf('function AtividadesParadas('));

/**
 * "DIZ 'UMA ATIVIDADE PARADA HÁ MAIS DE 7 DIAS', EU CLICO E ABRE A AGENDA, MAS
 * NÃO ABRE A ATIVIDADE QUE ESTÁ PARADA." — relato de 12/09/2026.
 *
 * A faixa levava para `/agenda` puro, e a agenda abre na aba de HOJE: a pessoa
 * caía num quadro vazio e tinha de adivinhar qual era. A agenda já sabia abrir
 * uma atividade por `?compromisso=<id>`; faltava a faixa saber QUAL.
 */
describe('a faixa de atividades paradas leva à atividade', () => {
  it('o painel entrega a lista, e não só o número', () => {
    expect(PAINEL).toContain(
      '<AtividadesParadas total={alertas.semMovimentacao} itens={alertas.paradas ?? []} />',
    );
    expect(TIPO).toContain('paradas?: {');
  });

  it('cada atividade abre direto na agenda, pelo id', () => {
    expect(FAIXA).toContain('href={`/agenda?compromisso=${a.id}`}');
  });

  /**
   * UMA SÓ não pede "Ver quais": a frase já diz qual é, e a faixa inteira é o
   * atalho. Um clique a mais para ver o que cabia na frase seria atrito à toa.
   */
  it('com uma, a faixa inteira é o atalho', () => {
    expect(FAIXA).toContain('if (total === 1) {');
    expect(FAIXA).toContain('<strong className="text-foreground">{a.titulo}</strong>');
  });

  it('com várias, abre no lugar como o aviso do CNJ', () => {
    expect(FAIXA).toContain("{aberto ? 'Ocultar' : 'Ver quais'}");
    expect(FAIXA).toContain('aria-expanded={aberto}');
    expect(FAIXA).toContain('<AvatarPessoa');
  });

  /** O teto é de dez — dizer quantas ficaram de fora impede a lista de parecer o todo. */
  it('diz quantas ficaram fora da lista', () => {
    expect(FAIXA).toContain('total > itens.length');
  });

  /**
   * A JANELA DE TROCA: web e API sobem separados. Com a API de antes a lista não
   * vem, e a faixa volta a ser número e agenda — em vez de sumir ou quebrar.
   */
  it('sem a lista, cai no comportamento antigo', () => {
    expect(FAIXA).toContain('if (!itens.length) {');
    expect(FAIXA).toContain('<AlertBar tom="info" href="/agenda" acao="Abrir agenda">');
  });

  /** A frase montada no próprio JSX do painel saiu: agora quem fala é o componente. */
  it('a faixa antiga, sem destino, não existe mais no corpo do painel', () => {
    expect(PAINEL).not.toContain('{alertas.semMovimentacao === 1');
  });
});

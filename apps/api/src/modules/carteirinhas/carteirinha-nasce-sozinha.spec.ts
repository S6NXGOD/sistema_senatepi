import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANTS } from '../../tenant/tenant.config';

/**
 * O fonte sem comentários — negativa mira CÓDIGO, nunca a prosa que explica.
 *
 * `
` vira `
` antes de qualquer comparação: os arquivos deste repositório
 * são CRLF, e uma asserção de DUAS linhas nunca casa sem isto — falha que
 * parece defeito do código e é do teste.
 */
const semComentario = (rel: string) =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * "O QUE É ESSE 'EMITIR CARTEIRINHA'? ISSO NÃO É UM RETRABALHO PARA A
 * SECRETARIA DO SINDICATO?" — o dono, 25/09/2026.
 *
 * É, e a medição dá a ele (produção):
 *
 *   ativos ...................... 5.810
 *   já tinham carteirinha ....... 5.642   (todas na carga de 03/07/2026)
 *   sem carteirinha ................ 168   (2,9%)
 *   emitidas depois da carga ......... 1
 *
 * Um passo manual que servia a 2,9% das pessoas e, para elas, TRAVAVA o
 * documento até alguém lembrar de clicar. E o clique não decidia nada: o cartão
 * não carrega um único dado que o cadastro já não tenha — "emitir" só criava o
 * número e a validade, que o sistema gera sozinho.
 */
describe('a carteirinha nasce quando alguém precisa dela', () => {
  const fonte = semComentario('./carteirinhas.module.ts');

  it('o PDF garante a carteirinha antes de desenhar', () => {
    expect(fonte).toContain('const carteirinha = await this.garantirCarteirinha(filiadoId);');
  });

  /** O beco de 168 pessoas não existe mais no caminho do documento. */
  it('pedir o PDF não devolve mais "não emitida"', () => {
    expect(fonte).not.toContain("throw new NotFoundException('Carteirinha não emitida')");
  });

  /**
   * RENOVA SOZINHA QUANDO VENCE. Zero vencidas hoje, porque a carga é de julho
   * — todas vencem em julho de 2027, no mesmo dia. Sem renovação automática,
   * 5.642 cartões viram papel inválido de uma vez e a secretaria descobre pelo
   * telefone.
   */
  it('renova a vencida em vez de entregar cartão inválido', () => {
    expect(fonte).toContain('const vencida = !!existente.validaAte && existente.validaAte < new Date();');
    expect(fonte).toContain('data: { validaAte: daquiAUmAnoBR(), status: StatusCarteirinha.ATIVA },');
  });

  /**
   * E O NÚMERO NÃO MUDA NA RENOVAÇÃO. Ele é a identidade do cartão no histórico
   * e na conferência: trocá-lo faria a carteirinha de dezembro não ser a mesma
   * de janeiro para quem tivesse anotado o número.
   */
  it('a renovação não gera número novo', () => {
    const inicio = fonte.indexOf('if (existente) {');
    const fim = fonte.indexOf('if (filiado.situacao !== SituacaoFiliado.ATIVO)', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fonte.slice(inicio, fim)).not.toContain('comNumeroLivre');
  });

  /** Quem não está ATIVO não ganha cartão novo — nem renovação. */
  it('só cria e só renova para quem está ATIVO', () => {
    expect(fonte).toContain("throw new BadRequestException('Carteirinha só pode ser emitida para filiado ATIVO')");
    expect(fonte).toContain('if (!vencida || filiado.situacao !== SituacaoFiliado.ATIVO) return existente;');
  });

  /**
   * A ROTA ANTIGA FICA, e é de propósito: durante a janela de troca do deploy o
   * contêiner ANTIGO do web ainda chama `POST /emitir`, e um 404 ali quebraria
   * a carteirinha justamente de quem tentasse baixá-la naquele minuto. Hoje ela
   * é um apelido idempotente.
   */
  it('POST /emitir continua respondendo, agora idempotente', () => {
    expect(fonte).toContain('async emitir(filiadoId: string) {\n    return this.garantirCarteirinha(filiadoId);');
  });
});

/**
 * "O SINDICATO É DA ENFERMAGEM E NÃO DOS ENFERMEIROS." — o dono, 25/09/2026.
 *
 * O nome curto — que é o que sai IMPRESSO no cabeçalho do cartão — dizia
 * "Sindicato dos Enfermeiros do Piauí", deixando de fora auxiliares e técnicos.
 * São duas das três categorias do nome completo, e a maior parte da base.
 */
describe('o nome que sai no cartão inclui a categoria inteira', () => {
  it('o SENATEPI não se chama "dos enfermeiros"', () => {
    const curto = TENANTS.senatepi.nomeCurto;
    expect(curto).not.toMatch(/dos Enfermeiros/i);
    expect(curto).toMatch(/Enfermagem/i);
  });

  /** E o nome completo continua nomeando as três, que é o registro legal. */
  it('o nome completo mantém as três categorias', () => {
    const nome = TENANTS.senatepi.nome.toUpperCase();
    for (const categoria of ['ENFERMEIROS', 'AUXILIARES', 'TÉCNICOS']) {
      expect(nome).toContain(categoria);
    }
  });
});

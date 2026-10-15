import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { erroDoAssuntoNoDesfecho } from '@/lib/atendimentos';
import { rotuloDaEntidade } from '@/lib/auditoria';
import { linkWhatsApp } from '@/lib/cobrancas';

/*
  Achados confirmados da revisão adversarial de 13/09/2026 (frente
  web-telas-robustez). As asserções de fonte miram CÓDIGO: os comentários são
  retirados antes, porque a explicação em português cita as mesmas palavras.
*/
const ler = (rel: string) =>
  readFileSync(resolve(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

const semComentarios = (fonte: string) =>
  fonte
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const codigo = (rel: string) => semComentarios(ler(rel));

/**
 * UMA REVALIDAÇÃO QUE FALHA NÃO APAGA O QUE ESTÁ NA TELA.
 *
 * No React Query 5, a revalidação que falha (foco na janela depois de 30 s,
 * invalidação depois de salvar, contêiner reiniciando no deploy) liga isError
 * e GUARDA o data. Um ramo `isError ?` antes do conteúdo trocava lista e ficha
 * boas pela tela de erro, e nas telas de edição desmontava o formulário com o
 * que a pessoa tinha digitado.
 */
describe('a tela de erro só aparece quando não há dado', () => {
  const TELAS: [string, string][] = [
    ['app/(dashboard)/colaboradores/[id]/editar/page.tsx', '{isError && !data ? ('],
    ['app/(dashboard)/configuracoes/page.tsx', '{isError && !perfil ? ('],
    ['app/(dashboard)/organizacoes/page.tsx', '{isError && !data ? ('],
    ['app/(dashboard)/usuarios/page.tsx', '{isError && !data ? ('],
    ['app/(dashboard)/colonia-admin/page.tsx', '{isError && !data ? ('],
    ['app/(dashboard)/colaboradores/[id]/page.tsx', 'if (isError && !c) {'],
    ['app/(dashboard)/eventos/[id]/page.tsx', 'if (isError && !evento) {'],
    ['components/filiados/dossie-drawer.tsx', '{falhou && !data ? ('],
    ['components/organizacoes/organizacao-drawer.tsx', '{falhou && !data ? ('],
    ['components/eventos/encerramento.tsx', 'if (falhou && !resumo) {'],
  ];

  it.each(TELAS)('%s', (caminho, condicao) => {
    const src = codigo(caminho);
    expect(src).toContain('<FalhaAoCarregar');
    expect(src).toContain(condicao);
    expect(src).not.toMatch(/\{\s*(isError|falhou)\s*\?\s*\(/);
    expect(src).not.toMatch(/if\s*\(\s*(isError|falhou)\s*\)/);
  });

  /** A lista de usuários lia `data: usuarios = []`: com o padrão, `!data` nunca seria verdade. */
  it('usuários olha o data de verdade, não o padrão vazio', () => {
    expect(codigo('app/(dashboard)/usuarios/page.tsx')).not.toContain('data: usuarios = []');
  });
});

/**
 * REGISTRO ANTIGO COM "OUTRO" FECHA SEM RECLASSIFICAR.
 *
 * A coluna assunto_outro nasceu nula para todo atendimento anterior. O modal
 * validava o assunto sempre, e o desfecho ficava preso num campo "(opcional)".
 */
describe('assunto no registro do desfecho', () => {
  it('não mexeu: não confere, mesmo com Outro sem texto', () => {
    expect(erroDoAssuntoNoDesfecho({ assunto: 'OUTRO', assuntoOutro: null }, { assunto: 'OUTRO', assuntoOutro: '' })).toBeNull();
    expect(erroDoAssuntoNoDesfecho({ assunto: null }, { assunto: '' })).toBeNull();
  });

  it('escolheu Outro agora: exige o texto', () => {
    expect(erroDoAssuntoNoDesfecho({ assunto: 'REMUNERACAO' }, { assunto: 'OUTRO', assuntoOutro: '' })).toMatch(/pelo menos 3 letras/);
    expect(erroDoAssuntoNoDesfecho({ assunto: null }, { assunto: 'OUTRO', assuntoOutro: 'ab' })).toMatch(/pelo menos 3 letras/);
  });

  it('mexeu no texto e deixou curto: exige o texto', () => {
    expect(erroDoAssuntoNoDesfecho({ assunto: 'OUTRO', assuntoOutro: 'aposentadoria' }, { assunto: 'OUTRO', assuntoOutro: 'a' })).toMatch(/pelo menos 3 letras/);
  });

  it('trocou para outro assunto qualquer: passa', () => {
    expect(erroDoAssuntoNoDesfecho({ assunto: 'OUTRO', assuntoOutro: null }, { assunto: 'REMUNERACAO', assuntoOutro: '' })).toBeNull();
  });

  it('o modal usa a regra que olha a mudança', () => {
    const modal = codigo('components/atendimentos/registrar-desfecho-modal.tsx');
    expect(modal).toContain('erroDoAssuntoNoDesfecho(atendimento ?? {}, { assunto, assuntoOutro })');
    expect(modal).not.toContain('erroDoAssunto(assunto, assuntoOutro)');
  });
});

/** Convite do Teams passa de 200 caracteres sem espaço: a 400 px a ajuda saía da caixa. */
describe('link da chamada no diálogo estreito', () => {
  it('a linha de ajuda do link quebra em qualquer ponto', () => {
    const modal = codigo('components/atendimentos/registrar-desfecho-modal.tsx');
    expect(modal).toMatch(/id=\{`\$\{tituloId\}-link-ajuda`\}\s*className=\{cn\('break-all /);
  });
});

/**
 * COBRANÇA PELO WHATSAPP COM O TELEFONE SECUNDÁRIO.
 * Medido em 13/09/2026: 383 filiados ativos têm o celular só no secundário.
 */
describe('WhatsApp da cobrança lê o secundário', () => {
  it('a regra aceita o celular que está só no secundário', () => {
    expect(linkWhatsApp(null, 'Olá', '(86) 99912-3456')).toBe('https://wa.me/5586999123456?text=Ol%C3%A1');
  });

  it('a ação da parcela passa o secundário e não recusa quem só tem ele', () => {
    const src = codigo('components/cobrancas/parcela-actions.tsx');
    expect(src).toContain('linkWhatsApp(tel, msg, secundario)');
    expect(src).toContain('if (!tel && !secundario) {');
  });

  it('a seção financeira e a ficha levam o secundário até a parcela', () => {
    expect(codigo('components/filiados/financeiro-section.tsx')).toContain('telefoneSecundario: filiado.telefoneSecundario');
    expect(codigo('app/(dashboard)/filiados/[id]/page.tsx')).toContain('telefoneSecundario: f.telefoneSecundario }}');
  });
});

/** Entidade crua ("LinkRecadastramento") na coluna "Onde" não é português de gente. */
describe('auditoria do recadastro', () => {
  it('as entidades novas têm rótulo', () => {
    expect(rotuloDaEntidade('LinkRecadastramento')).toBe('Link de recadastramento');
    expect(rotuloDaEntidade('Recadastramento')).toBe('Recadastramento');
  });
});

/**
 * A TELA NÃO OFERECE O QUE A API VAI RECUSAR — anexos, 15/10/2026.
 *
 * Uma advogada com `atendimentos: VISUALIZAR` abria um atendimento, via "puxe
 * os que servirem", escolhia o documento e só então levava 403. O anexo herda
 * o módulo de quem o segura, e escrever ali exige EDITAR nesse módulo; a tela
 * não perguntava nada.
 *
 * A LEITURA CONTINUA INTEIRA: quem só visualiza vê a lista e baixa os
 * documentos. O que some é a promessa que terminaria em erro.
 */
describe('a seção de anexos esconde o que a pessoa não pode fazer', () => {
  const src = codigo('components/anexos/anexos-section.tsx');

  it('sabe de que módulo é o registro que segura o anexo', () => {
    expect(src).toContain('const moduloDoAlvo: ModuloKey | null = atendimentoId');
    expect(src).toContain("? 'atendimentos'");
    expect(src).toContain("? 'processos'");
    expect(src).toContain("? 'agenda'");
  });

  /** Sem alvo não há onde gravar — e `else` de ternário não vira fato. */
  it('sem registro-pai, não assume um módulo qualquer', () => {
    expect(src).toContain('!!moduloDoAlvo &&');
    expect(src).not.toContain(": 'agenda';");
  });

  it('e exige EDITAR nele para oferecer envio ou puxar', () => {
    expect(src).toContain(
      "nivelEfetivo(user?.role, user?.permissoes, moduloDoAlvo) === 'EDITAR'",
    );
    expect(src).toContain('{aPuxar > 0 && podeGravar && (');
    expect(src).toContain('{podeGravar && (');
  });

  /**
   * A LISTA E O DOWNLOAD NÃO DEPENDEM DE `podeGravar` — leitura é leitura.
   *
   * A asserção mira a LISTA, e não "tudo que vem depois dela". A primeira
   * versão cortava de `anexos.map(` até o fim do arquivo, e passou a reprovar
   * em 15/10/2026 por um motivo legítimo: o RECADO do vazio passou a dizer à
   * pessoa que só visualiza por que não há botão de enviar. Isso é mensagem,
   * não lista — e um teste que não distingue as duas coisas impede o conserto
   * em vez de proteger o comportamento.
   */
  it('mas a lista de documentos continua para quem só visualiza', () => {
    const i = src.indexOf('anexos.map(');
    const lista = src.slice(i, src.indexOf('</ul>', i));
    expect(lista).toContain('<AnexoItem');
    expect(lista).not.toContain('podeGravar');
  });

  /**
   * O VAZIO EXPLICA A AUSÊNCIA DO BOTÃO (15/10/2026).
   *
   * Uma advogada abriu um atendimento e viu só "Histórico: nenhum" e "Anexos:
   * nenhum", sem área de envio — e o chamado chegou como "está bugando". O
   * dado estava certo; o que faltava era a tela dizer que a ausência do botão
   * é a permissão dela, e não uma falha.
   */
  it('e o vazio diz por que não há onde enviar', () => {
    expect(src).toContain('Nenhum documento aqui.');
    expect(src).toContain("!podeGravar && ' Seu perfil vê e baixa documentos deste registro, mas não envia.'");
  });

  /** Quem só lê também precisa saber que o documento existe em outro lugar. */
  it('e aponta o acervo do filiado para quem não pode puxar', () => {
    expect(src).toContain('{aPuxar > 0 && !podeGravar && filiadoId && (');
    expect(src).toContain('abra a ficha para ver.');
  });
});

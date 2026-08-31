/**
 * O NOME COM QUE O ARQUIVO CHEGA NA PASTA DE DOWNLOADS DE QUEM BAIXOU.
 *
 * O problema
 * ----------
 * Todos os oito documentos gerados pelo sistema saíam nomeados por UUID:
 * `carteirinha-9f58939f-fb64-41ee-bfc2-f0def1c6e02c.pdf`,
 * `termo-desfiliacao-<uuid>.pdf`, `dossie-<uuid>.pdf`, `cracha-<uuid>.pdf`…
 *
 * Quem baixa a carteirinha de doze filiados numa tarde fica com doze arquivos
 * indistinguíveis na pasta, e a única forma de saber qual é qual é abrir um por
 * um. Pior no jurídico: o termo assinado é anexado de volta ao sistema, e o
 * arquivo que circula por e-mail com a diretoria se chama `termo-<uuid>.pdf`.
 *
 * Duas armadilhas que este utilitário existe para evitar
 * ------------------------------------------------------
 * 1. ACENTO NO CABEÇALHO HTTP. `Content-Disposition` é um cabeçalho, e cabeçalho
 *    é ASCII. Mandar `filename="Carteirinha - João.pdf"` cru produz mojibake ou
 *    faz o navegador descartar o nome inteiro. A solução é a da RFC 5987/6266:
 *    mandar OS DOIS — `filename=` com a versão transliterada, para clientes
 *    antigos, e `filename*=UTF-8''…` percent-encoded, que os navegadores atuais
 *    preferem.
 *
 * 2. INJEÇÃO DE CABEÇALHO. O nome costuma vir de dado do usuário (nome do
 *    filiado, nome do arquivo que ele subiu). Um `\r\n` ali dentro parte o
 *    cabeçalho em dois e deixa quem chamou escrever cabeçalhos arbitrários na
 *    resposta. Aspas fazem estrago menor, mas quebram o nome do mesmo jeito.
 *    Por isso NADA sai daqui sem passar pela sanitização.
 */

/**
 * O que nunca pode sair daqui.
 *
 * `\p{Cc}` é a categoria Unicode de CONTROLE, e é essa metade que importa para
 * a segurança: uma quebra de linha no meio do nome parte o `Content-Disposition`
 * em dois e deixa quem controla o dado escrever cabeçalhos arbitrários na
 * resposta. O nome costuma vir de dado do usuário — nome do filiado, nome do
 * arquivo que ele subiu —, então isto não é hipótese remota.
 *
 * Os demais (`<>:"/\|?*`) são os proibidos em nome de arquivo no Windows; a
 * barra também impede que um nome vire caminho.
 *
 * O HÍFEN E O ESPAÇO FICAM: são o separador que este módulo usa entre os
 * pedaços, e tirá-los estragaria tanto o resultado quanto nomes legítimos
 * ("MAT. MARQUES-BASTOS").
 */
const PROIBIDOS = /[\p{Cc}<>:"/\\|?*]/gu;

/**
 * Nomes reservados do Windows: um arquivo chamado `CON.pdf` não pode ser salvo.
 * Improvável, mas o custo de tratar é uma linha.
 */
const RESERVADOS_WINDOWS = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)$/i;

/** Teto de caracteres. O limite dos sistemas de arquivos é 255 bytes. */
const MAX = 120;

/** Tira acento, mantendo a letra base — "João" vira "Joao". */
function semAcento(v: string): string {
  return v.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Limpa um pedaço de nome: sem barra, sem aspas, sem controle, sem espaço
 * duplicado. Devolve string vazia quando não sobra nada de útil.
 */
export function pedacoDeNome(valor: string | null | undefined): string {
  return String(valor ?? '')
    .replace(PROIBIDOS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Monta o nome do arquivo a partir dos pedaços que o identificam.
 *
 * Os pedaços vazios somem — assim quem chama não precisa de `if` para o filiado
 * sem nome ou para a data opcional:
 *
 *   nomeDeArquivo(['Carteirinha', filiado.nomeCompleto], 'pdf')
 *     -> "Carteirinha - MARIA APARECIDA DA CONCEIÇÃO.pdf"
 *
 * O separador é " - " e não "_": o nome é lido por gente, na pasta de
 * downloads e no anexo do e-mail, e underline ali é herança de quando nome de
 * arquivo não podia ter espaço.
 */
export function nomeDeArquivo(partes: Array<string | null | undefined>, extensao: string): string {
  const limpas = partes.map(pedacoDeNome).filter(Boolean);
  const base =
    (limpas.join(' - ') || 'documento')
      .slice(0, MAX)
      // Ponto à esquerda esconde o arquivo no Linux e no macOS, e é o que sobra
      // de um "../../etc/passwd" depois que as barras viram espaço.
      .replace(/^[.\s]+/, '')
      .trim() || 'documento';
  const ext = pedacoDeNome(extensao).replace(/^\.+/, '').toLowerCase() || 'bin';
  const seguro = RESERVADOS_WINDOWS.test(base) ? `${base}_` : base;
  return `${seguro}.${ext}`;
}

/** `2026-08-31` — data ISO curta, que ordena sozinha na pasta. */
export function dataParaNome(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * O valor completo do cabeçalho `Content-Disposition`.
 *
 * `inline` para o que o navegador sabe exibir (PDF e imagem): abre na aba E
 * ainda assim salva com o nome certo, que é o melhor dos dois. `attachment`
 * para o resto — um .docx exibido não existe, e sem isto ele baixa com o nome
 * errado depois de uma tentativa frustrada de renderizar.
 */
export function conteudoDisposto(nome: string, modo: 'inline' | 'attachment' = 'inline'): string {
  // Nome sem ponto não tem extensão — separar às cegas produziria
  // "relatorio.relatorio", que é o tipo de detalhe que só aparece em produção.
  const corte = nome.lastIndexOf('.');
  const base = corte > 0 ? nome.slice(0, corte) : nome;
  const ext = corte > 0 ? nome.slice(corte + 1) : 'bin';
  const seguro = nomeDeArquivo([base], ext);
  const ascii = semAcento(seguro).replace(/[^\x20-\x7e]/g, '').replace(/"/g, '') || 'documento';
  // `filename*` é o que os navegadores atuais leem; `filename` é a rede de
  // segurança para quem não entende RFC 5987.
  return `${modo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(seguro)}`;
}

/** Tipos que o navegador exibe sem baixar — ver `conteudoDisposto`. */
const EXIBIVEIS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']);

/** `inline` para o que dá para ver na aba; `attachment` para o resto. */
export function modoPorExtensao(nomeOuExtensao: string): 'inline' | 'attachment' {
  const ext = (nomeOuExtensao.split('.').pop() ?? '').toLowerCase();
  // SVG é exibível mas é documento ativo: baixa, para não virar vetor de XSS
  // caso um dia o filtro de upload o aceite.
  if (ext === 'svg') return 'attachment';
  return EXIBIVEIS.has(ext) ? 'inline' : 'attachment';
}

/**
 * O par que todo gerador de documento devolve.
 *
 * O nome sai de dentro do gerador, e não do controller, por um motivo prático:
 * é o gerador que já carregou a pessoa ou o processo para desenhar o documento.
 * Deixar o controller nomear obrigaria uma segunda consulta ao banco só para
 * descobrir como o arquivo deve se chamar — ou, como acontecia, a desistir e
 * usar o UUID que ele tem em mãos.
 */
export interface DocumentoGerado {
  pdf: Buffer;
  nomeArquivo: string;
}

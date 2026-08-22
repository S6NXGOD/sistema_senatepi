/**
 * "Este réu já não está cadastrado com outro nome?"
 *
 * POR QUE A BUSCA NORMAL NÃO RESOLVE
 * O autocomplete usa `contains`: procura o texto digitado DENTRO do nome
 * gravado. Isso só acha quem digita menos do que está cadastrado. Quem digita
 * "PRONTOCARE CLINICA E ATENDIMENTOS LTDA" não encontra o "PRONTOCARE" que já
 * existe — e cadastra o segundo. Foi assim que o cadastro de produção ficou com
 * os dois, e a conta de "quantos processos temos contra esta empresa" — a razão
 * de o cadastro existir — passou a mentir.
 *
 * A COMPARAÇÃO AQUI É POR PALAVRA, nos dois sentidos, ignorando o que não
 * identifica ninguém: forma societária (LTDA, S/A, EIRELI, ME, EPP) e palavras
 * genéricas do ramo (CLINICA, HOSPITAL, SERVIÇOS…). Sem essa limpeza,
 * "CLINICA A" e "CLINICA B" pareceriam a mesma coisa por causa de "CLINICA".
 *
 * Função pura porque é regra de negócio que erra fácil nos dois sentidos —
 * avisar demais treina a pessoa a ignorar o aviso; avisar de menos deixa o
 * duplicado nascer.
 */

/** Formas societárias e abreviações que não identificam a empresa. */
const RUIDO_SOCIETARIO = new Set([
  'ltda', 'sa', 's', 'a', 'me', 'epp', 'eireli', 'mei', 'cia', 'ei',
]);

/**
 * Palavras comuns demais no ramo para servirem de indício sozinhas.
 *
 * Todas aparecem no cadastro real do SENATEPI (hospitais, clínicas, fundações
 * e secretarias de saúde). Se "hospital" contasse, "HOSPITAL GETÚLIO VARGAS" e
 * "HOSPITAL UNIVERSITÁRIO DA UFPI" seriam apontados como o mesmo cadastro.
 */
const RUIDO_RAMO = new Set([
  'clinica', 'clinicas', 'hospital', 'hospitalar', 'servicos', 'servico',
  'atendimento', 'atendimentos', 'saude', 'medica', 'medicos', 'medico',
  'fundacao', 'instituto', 'secretaria', 'estado', 'municipal', 'municipio',
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'a', 'o',
  'sindicato', 'associacao', 'empresa', 'centro', 'unidade',
]);

/**
 * TOPÔNIMO NÃO IDENTIFICA ORGANIZAÇÃO — e sozinho gera falso positivo.
 *
 * Medido no cadastro real em 21/08/2026: a varredura apontou "HOSPITAL DE
 * URGÊNCIA DE TERESINA" como duplicata de "FUNDAÇÃO MUNICIPAL DE SAÚDE DE
 * TERESINA", e "SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ" como duplicata do
 * próprio SINDICATO. Em cada par, a ÚNICA palavra em comum era o lugar — tudo
 * o mais tinha sido descartado como ruído de ramo.
 *
 * No aviso ao digitar isso passava: a pessoa está olhando o nome e descarta em
 * um segundo. Numa FILA de limpeza é fatal — dois falsos positivos entre dois
 * resultados e ninguém abre a lista de novo.
 *
 * Os nomes de UF são lista fechada e nunca identificam ninguém. Cidade é
 * infinita, e por isso `partesParecidas` recebe `ruidoExtra`: a varredura passa
 * as cidades DO PRÓPRIO CADASTRO, que é a informação que já temos.
 */
const RUIDO_GEOGRAFICO = new Set([
  'acre', 'alagoas', 'amapa', 'amazonas', 'bahia', 'ceara', 'distrito', 'federal',
  'espirito', 'santo', 'goias', 'maranhao', 'mato', 'grosso', 'sul', 'minas',
  'gerais', 'para', 'paraiba', 'parana', 'pernambuco', 'piaui', 'rio', 'janeiro',
  'grande', 'norte', 'rondonia', 'roraima', 'catarina', 'sao', 'paulo', 'sergipe',
  'tocantins', 'brasil', 'brasileiro', 'brasileira', 'nacional', 'regional',
  'estadual', 'federal',
  // Siglas de UF: "MUNICÍPIO DE X -PI" e "Associação de X-PI" compartilhariam
  // o "pi" e isso contaria como indício.
  'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg',
  'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to',
]);

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Palavras que de fato identificam o cadastro. */
export function palavrasSignificativas(nome: string, ruidoExtra?: Set<string>): string[] {
  return normalizar(nome)
    .split(' ')
    .filter(
      (p) =>
        p.length >= 2 &&
        !RUIDO_SOCIETARIO.has(p) &&
        !RUIDO_RAMO.has(p) &&
        !RUIDO_GEOGRAFICO.has(p) &&
        !ruidoExtra?.has(p),
    );
}

/**
 * Monta o ruído extra a partir das CIDADES do próprio cadastro.
 *
 * Nome de cidade é lista infinita e muda por sindicato — mas as que importam
 * estão ali, no campo `cidade` das organizações já cadastradas. Usar o dado que
 * já temos é mais honesto que manter uma lista de municípios no código.
 */
export function ruidoDeCidades(partes: Array<{ cidade?: string | null }>): Set<string> {
  const r = new Set<string>();
  for (const p of partes) {
    for (const palavra of normalizar(p.cidade ?? '').split(' ')) {
      if (palavra.length >= 3) r.add(palavra);
    }
  }
  return r;
}

/**
 * Por que um cadastro foi apontado, do indício mais forte para o mais fraco.
 *
 * `CONTEM` é o mais fraco e NÃO sai desta função: é acrescentado pelo serviço,
 * por busca de substring, e existe para cobrir o buraco que a comparação por
 * palavra deixa de propósito. Digitar "Município" não produz palavra
 * significativa nenhuma — `municipio` é ruído de ramo, senão toda prefeitura
 * seria duplicata de todas as outras —, então a comparação fica muda enquanto o
 * autocomplete, que usa `contains`, mostra os municípios cadastrados. Quem está
 * digitando não tem como saber que são dois algoritmos, e a mudez parece falha.
 */
export type MotivoSemelhanca =
  | 'MESMO_DOCUMENTO'
  | 'MESMO_NOME'
  | 'CONTIDO'
  | 'PALAVRAS_EM_COMUM'
  | 'CONTEM';

export interface Candidato {
  id: string;
  nome: string;
  documento?: string | null;
}

export interface Semelhante<T extends Candidato> {
  parte: T;
  motivo: MotivoSemelhanca;
  /** 0 a 1 — usado só para ordenar, não é exibido. */
  forca: number;
}

/**
 * Cadastros que podem ser a mesma parte que se está digitando.
 *
 * A ordem é do indício mais forte para o mais fraco, e o corte é deliberado:
 *
 *  MESMO_DOCUMENTO   CNPJ/CPF igual — é a mesma pessoa, ponto.
 *  MESMO_NOME        idênticos depois de tirar acento, pontuação e "LTDA".
 *  CONTIDO           todas as palavras significativas de um estão no outro
 *                    ("PRONTOCARE" ⊂ "PRONTOCARE CLINICA E ATENDIMENTOS").
 *  PALAVRAS_EM_COMUM metade ou mais das palavras significativas coincidem.
 *
 * Nome sem NENHUMA palavra significativa (só "CLINICA LTDA") não gera aviso:
 * ali não há indício, e apontar qualquer coisa seria ruído.
 */
export function partesParecidas<T extends Candidato>(
  nomeDigitado: string,
  documentoDigitado: string | null | undefined,
  candidatos: T[],
  limite = 5,
  /** Palavras que neste cadastro não identificam ninguém (cidades, p. ex.). */
  ruidoExtra?: Set<string>,
): Semelhante<T>[] {
  const nome = normalizar(nomeDigitado);
  if (nome.length < 3) return [];

  const palavras = palavrasSignificativas(nomeDigitado, ruidoExtra);
  const doc = (documentoDigitado ?? '').replace(/\D/g, '');
  const achados: Semelhante<T>[] = [];

  for (const c of candidatos) {
    const cNome = normalizar(c.nome);
    const cDoc = (c.documento ?? '').replace(/\D/g, '');

    if (doc.length >= 11 && cDoc === doc) {
      achados.push({ parte: c, motivo: 'MESMO_DOCUMENTO', forca: 1 });
      continue;
    }
    if (cNome === nome) {
      achados.push({ parte: c, motivo: 'MESMO_NOME', forca: 0.95 });
      continue;
    }

    const cPalavras = palavrasSignificativas(c.nome, ruidoExtra);
    if (!palavras.length || !cPalavras.length) continue;

    const comuns = palavras.filter((p) => cPalavras.includes(p));
    if (!comuns.length) continue;

    // Um contém o outro: o caso clássico do nome curto x razão social completa.
    const contido =
      comuns.length === palavras.length || comuns.length === cPalavras.length;
    if (contido) {
      achados.push({ parte: c, motivo: 'CONTIDO', forca: 0.9 });
      continue;
    }

    // Dice: o dobro da interseção sobre a soma dos tamanhos.
    const dice = (2 * comuns.length) / (palavras.length + cPalavras.length);
    if (dice >= 0.5) achados.push({ parte: c, motivo: 'PALAVRAS_EM_COMUM', forca: dice });
  }

  return achados
    .sort((a, b) => b.forca - a.forca || a.parte.nome.localeCompare(b.parte.nome))
    .slice(0, limite);
}

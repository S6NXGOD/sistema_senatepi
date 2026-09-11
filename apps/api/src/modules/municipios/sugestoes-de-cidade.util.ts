import { chavesDoTexto, siglaDeUF } from './chave-de-ente.util';

/**
 * PALPITES PARA A CIDADE QUE O CASAMENTO NÃO RECONHECEU — para uma pessoa
 * confirmar, nunca para gravar sozinho.
 *
 * A varredura só liga o que consegue PROVAR (nome exato, com ou sem UF). O que
 * sobra é grafia torta, e na produção de 11/09/2026 eram 43 filiados em 16
 * grafias: "Monte Alegre" (20 — no Piauí o nome é Monte Alegre do Piauí),
 * "MORRO CABEÇA DO TEMPO" (é "no Tempo"), "TERSINA", "TEESINA", "TIMON/PI"
 * (Timon é do Maranhão)...
 *
 * Adivinhar e gravar seria o sistema inventando endereço de gente. Mostrar o
 * palpite ao lado de um botão transforma um trabalho de meia hora — descobrir,
 * para cada grafia, qual município era — em dezesseis cliques. A decisão
 * continua sendo de quem clica, e fica carimbada como MANUAL.
 */

export interface EnteDoCatalogo {
  codigo: number;
  nome: string;
  uf: string;
  nomeNormalizado: string;
}

export type MotivoDaSugestao =
  /** "Monte Alegre" → Monte Alegre do Piauí: o nome oficial começa pelo que foi digitado. */
  | 'COMECA_IGUAL'
  /** "TERSINA" → Teresina: uma ou duas letras de diferença. */
  | 'ESCRITA_PARECIDA'
  /** "TIMON/PI" → Timon/MA: o nome existe, a UF digitada é que está errada. */
  | 'MESMO_NOME_EM_OUTRA_UF';

export interface SugestaoDeMunicipio {
  codigo: number;
  nome: string;
  uf: string;
  motivo: MotivoDaSugestao;
}

/**
 * DISTÂNCIA DE EDIÇÃO (Levenshtein) com teto — acima do teto, tanto faz quanto.
 *
 * O teto não é otimização prematura: o palpite compara cada grafia com os 224
 * municípios da UF, e sem ele o custo seria calcular a distância inteira entre
 * "teresina" e "santo antonio de lisboa" só para descartar.
 */
export function distancia(a: string, b: string, teto = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let menorDaLinha = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + custo);
      if (atual[j] < menorDaLinha) menorDaLinha = atual[j];
    }
    if (menorDaLinha > teto) return teto + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * QUANTAS LETRAS DE DIFERENÇA SE ACEITA, pelo tamanho do que foi digitado.
 *
 * Nome curto não tolera erro nenhum: "Caxias" a uma letra de distância vira
 * outro município. De cinco a oito letras, uma ("TERSINA" → Teresina). Acima
 * disso, duas ("CAZAJEIRAS" → Cajazeiras do Piauí, que é uma troca de letras).
 */
function tolerancia(tamanho: number): number {
  if (tamanho <= 4) return 0;
  if (tamanho <= 8) return 1;
  return 2;
}

export function sugerirMunicipios(
  cidade: string | null | undefined,
  estado: string | null | undefined,
  catalogo: EnteDoCatalogo[],
  ufDaCasa: string,
  maximo = 3,
): SugestaoDeMunicipio[] {
  const leituras = chavesDoTexto(cidade);
  if (!leituras.length) return [];

  const ufDigitada =
    siglaDeUF(estado) ?? leituras.find((l) => l.ufSugerida)?.ufSugerida ?? null;
  const ufAlvo = ufDigitada ?? ufDaCasa;

  /* Menor peso = melhor palpite. Um município só entra uma vez, com o melhor motivo. */
  const achados = new Map<number, { s: SugestaoDeMunicipio; peso: number }>();
  const propor = (e: EnteDoCatalogo, motivo: MotivoDaSugestao, peso: number) => {
    const atual = achados.get(e.codigo);
    if (!atual || atual.peso > peso) {
      achados.set(e.codigo, { s: { codigo: e.codigo, nome: e.nome, uf: e.uf, motivo }, peso });
    }
  };

  const procurarNaUF = (uf: string, penalidade: number) => {
    for (const { chave } of leituras) {
      const tol = tolerancia(chave.length);
      for (const e of catalogo) {
        if (e.uf !== uf) continue;
        const nome = e.nomeNormalizado;
        if (nome === chave) {
          propor(e, 'ESCRITA_PARECIDA', penalidade);
          continue;
        }
        if (nome.startsWith(chave + ' ')) {
          propor(e, 'COMECA_IGUAL', penalidade + 1);
          continue;
        }
        if (tol === 0) continue;
        /*
          DUAS COMPARAÇÕES: com o nome inteiro ("TERSINA" × "teresina") e com o
          começo dele do mesmo tamanho do que foi digitado ("CAZAJEIRAS" ×
          "cajazeiras" de "cajazeiras do piaui"). Sem a segunda, quem esquece o
          "do Piauí" e ainda erra uma letra fica sem palpite.

          A SEGUNDA SÓ PARA TEXTO LONGO. Com cinco letras, o começo de qualquer
          nome vira candidato: "CAXIA" ficava a uma letra de "caxin", de
          Caxingó — município errado com cara de palpite bom.
        */
        const d = Math.min(
          distancia(chave, nome, tol),
          chave.length >= 8 ? distancia(chave, nome.slice(0, chave.length), tol) : tol + 1,
        );
        if (d <= tol) propor(e, 'ESCRITA_PARECIDA', penalidade + 1 + d);
      }
    }
  };

  procurarNaUF(ufAlvo, 0);

  /*
    O NOME EXISTE, A UF É QUE ESTÁ ERRADA — "TIMON/PI", "BARÃO DE GRAJAÚ/PI"
    (os dois são do Maranhão) e "TERESINA/MA". Vem depois dos palpites da UF
    digitada, mas a UF da casa ganha das outras: morar em Teresina e digitar
    "MA" é mais provável que o contrário.
  */
  for (const { chave } of leituras) {
    for (const e of catalogo) {
      if (e.uf !== ufAlvo && e.nomeNormalizado === chave) {
        propor(e, 'MESMO_NOME_EM_OUTRA_UF', e.uf === ufDaCasa ? 2 : 4);
      }
    }
  }

  /*
    NADA NA UF DIGITADA: a grafia torta pode ser de um município da casa
    ("TERSINA/CE" é Teresina, não uma cidade do Ceará).
  */
  const achouNaUFAlvo = [...achados.values()].some((a) => a.s.uf === ufAlvo);
  if (!achouNaUFAlvo && ufAlvo !== ufDaCasa) procurarNaUF(ufDaCasa, 3);

  return [...achados.values()]
    .sort((a, b) => a.peso - b.peso || a.s.nome.localeCompare(b.s.nome, 'pt-BR'))
    .slice(0, maximo)
    .map((a) => a.s);
}

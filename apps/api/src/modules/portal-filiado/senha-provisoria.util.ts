import { randomInt } from 'node:crypto';

/**
 * A SENHA PROVISÓRIA — gerada pelo sistema, e ditada por telefone.
 *
 * "uma senha provisória gerada pelo sistema tanto pelo admin como no
 * recadastramento" — o dono, 24/09/2026.
 *
 * QUEM VAI USAR ISTO decide a forma. A secretaria gera a senha e a entrega pelo
 * WhatsApp, ou LÊ EM VOZ ALTA no balcão e no telefone. Uma senha aleatória de
 * 12 caracteres é ótima num gerenciador e péssima ditada: quem escuta erra o
 * "l" e o "1", o "O" e o "0", e liga de volta.
 *
 * Por isso: **duas palavras curtas e um número**, no formato `PALAVRA-PALAVRA-00`.
 * É fácil de falar, de anotar num papel e de digitar no celular — e ainda assim
 * tem espaço de sobra para o que ela precisa ser: uma senha de UMA VEZ, que o
 * portal obriga a trocar no primeiro acesso.
 *
 * O ESPAÇO: 64 palavras × 64 palavras × 100 = 409.600 combinações, sorteadas
 * com `randomInt` (CSPRNG, e não `Math.random`). Não é uma senha permanente e
 * não deve ser tratada como tal — é por isso que a troca é obrigatória no
 * servidor, e não só na tela. Ver o guard do portal.
 *
 * AS PALAVRAS são concretas, sem acento, sem "ç", sem plural e sem par que se
 * confunda ao ser falado. Nada de palavra que possa soar como ofensa ou como
 * julgamento da pessoa que vai recebê-la — quem lê a senha em voz alta é a
 * secretaria, para um filiado, no balcão.
 */
const PALAVRAS = [
  'AGUA', 'AREIA', 'ARCO', 'AZUL', 'BARCO', 'BRISA', 'CAJU', 'CAMPO',
  'CANTO', 'CARRO', 'CEDRO', 'CEU', 'CHUVA', 'COCO', 'CORAL', 'DUNA',
  'FAROL', 'FAVO', 'FEIRA', 'FERRO', 'FESTA', 'FIBRA', 'FOLHA', 'FONTE',
  'FORCA', 'FORNO', 'FRUTA', 'GIRA', 'GRAO', 'HORTA', 'ILHA', 'JANELA',
  'JARDIM', 'LAGO', 'LARANJA', 'LEITE', 'LIVRO', 'LUA', 'MANGA', 'MAPA',
  'MARE', 'MEL', 'MILHO', 'MOINHO', 'MORRO', 'NORTE', 'NUVEM', 'OLIVA',
  'ONDA', 'PALHA', 'PEDRA', 'PENA', 'PINHA', 'PONTE', 'PORTO', 'PRAIA',
  'RAIZ', 'REDE', 'RIO', 'SERRA', 'SINO', 'SOL', 'TRIGO', 'VELA',
] as const;

/** Só o que sobrevive a ser ditado: sem O/0, I/1, e sempre em caixa alta. */
const SEPARADOR = '-';

export function gerarSenhaProvisoria(): string {
  const a = PALAVRAS[randomInt(PALAVRAS.length)];
  let b = PALAVRAS[randomInt(PALAVRAS.length)];
  // Duas palavras iguais ("SOL-SOL-42") parecem defeito do gerador para quem
  // recebe, e ainda cortam o espaço de busca.
  while (b === a) b = PALAVRAS[randomInt(PALAVRAS.length)];
  const numero = String(randomInt(10, 100));
  return [a, b, numero].join(SEPARADOR);
}

/** Quantas palavras o gerador conhece — o teste conta, para ninguém encolher a lista. */
export const TOTAL_DE_PALAVRAS = PALAVRAS.length;

/**
 * O MÍNIMO QUE A SENHA ESCOLHIDA PELA PESSOA PRECISA TER.
 *
 * Seis caracteres, e nada além disso. Exigir maiúscula, número e símbolo num
 * portal usado por 5.810 pessoas — muitas no celular, no balcão, com pressa —
 * produz senha anotada no verso da carteirinha, que é pior do que uma senha
 * curta. A trava que importa aqui é a troca obrigatória da provisória, que
 * circulou por WhatsApp.
 */
export const TAMANHO_MINIMO_SENHA = 6;

export function motivoDeSenhaFraca(senha: string): string | null {
  const limpa = (senha ?? '').trim();
  if (limpa.length < TAMANHO_MINIMO_SENHA) {
    return `A nova senha precisa ter ao menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
  }
  if (!limpa) return 'A nova senha não pode ser só espaços.';
  return null;
}

/**
 * PixUtils — geração do "PIX Copia e Cola" estático (BR Code padrão EMV®QRCPS-MPM
 * do Banco Central). Monta o payload TLV e anexa o CRC16-CCITT.
 *
 * Referência: Manual de Padrões para Iniciação do Pix (BCB) — arranjo estático.
 */

export interface PixEstaticoParams {
  /** Chave PIX do recebedor (CPF/CNPJ/e-mail/telefone/aleatória). */
  chave: string;
  /** Nome do recebedor (campo 59, máx. 25 caracteres). */
  nome: string;
  /** Cidade do recebedor (campo 60, máx. 15 caracteres). */
  cidade: string;
  /** Valor da parcela em reais. Se ausente/zero, o pagador digita o valor. */
  valor?: number;
  /** Identificador da transação (txid, campo 62-05, máx. 25). Default "***". */
  identificador?: string;
}

/** Monta um campo EMV: ID (2) + comprimento (2, zero-pad) + valor. */
function campo(id: string, valor: string): string {
  const len = valor.length.toString().padStart(2, '0');
  return `${id}${len}${valor}`;
}

/**
 * Normaliza texto para o BR Code: remove acentos e mantém apenas o conjunto
 * imprimível aceito (letras, dígitos e pontuação básica).
 */
function normalizar(txt: string): string {
  return (txt ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // remove marcas de acento decompostas
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, '')
    .trim();
}

/** CRC16-CCITT (polinômio 0x1021, init 0xFFFF) — 4 dígitos hexadecimais maiúsculos. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Gera o payload "Copia e Cola" do PIX estático.
 * O mesmo texto pode ser convertido em QR Code no front/PDF do carnê.
 */
export function gerarPixCopiaECola(p: PixEstaticoParams): string {
  const chave = (p.chave ?? '').trim();
  if (!chave) throw new Error('Chave PIX não configurada.');

  const nome = (normalizar(p.nome).slice(0, 25) || 'RECEBEDOR').toUpperCase();
  const cidade = (normalizar(p.cidade).slice(0, 15) || 'CIDADE').toUpperCase();
  const txid = normalizar(p.identificador ?? '').replace(/\s+/g, '').slice(0, 25) || '***';

  // 26 — Merchant Account Information (arranjo Pix)
  const merchantAccount = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  // 62 — Additional Data Field Template (txid como Reference Label)
  const additionalData = campo('05', txid);

  const temValor = p.valor != null && p.valor > 0;

  let payload =
    campo('00', '01') + //                       Payload Format Indicator
    campo('26', merchantAccount) + //             Merchant Account Information (Pix)
    campo('52', '0000') + //                      Merchant Category Code
    campo('53', '986') + //                       Moeda: BRL (986)
    (temValor ? campo('54', p.valor!.toFixed(2)) : '') + // Valor da transação
    campo('58', 'BR') + //                        País
    campo('59', nome) + //                        Nome do recebedor
    campo('60', cidade) + //                      Cidade do recebedor
    campo('62', additionalData); //               Dados adicionais (txid)

  // CRC16: id (63) + comprimento fixo (04) + hash sobre tudo (inclui "6304").
  payload += '6304';
  return payload + crc16(payload);
}

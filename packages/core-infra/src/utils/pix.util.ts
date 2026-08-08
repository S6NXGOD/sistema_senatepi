/**
 * PixUtils — geração do "PIX Copia e Cola" estático (BR Code padrão EMV®QRCPS-MPM
 * do Banco Central), com sanitização RÍGIDA dos campos antes de montar o payload.
 *
 * A causa de "Não foi possível localizar a Chave Pix" costuma ser payload malformado:
 *  - chave numérica (CPF/CNPJ/telefone) enviada COM pontuação (length errado);
 *  - nome/cidade acima do limite de caracteres ou com acentos/caracteres especiais;
 *  - length dos blocos EMV sem `padStart(2,'0')`.
 *
 * Referência: Manual de Padrões para Iniciação do Pix (BCB).
 */

export interface PixEstaticoParams {
  /** Chave PIX do recebedor (CPF/CNPJ/e-mail/telefone/aleatória). */
  chave: string;
  /** Nome do recebedor (campo 59, máx. 25 caracteres). */
  nome: string;
  /** Cidade do recebedor (campo 60, máx. 15 caracteres). */
  cidade: string;
  /** Valor da transação em reais. Se ausente/zero, o pagador digita o valor. */
  valor?: number;
  /** Identificador (txid, campo 62-05, máx. 25, alfanumérico). Default "***". */
  identificador?: string;
}

// ---------------------------------------------------------------------------
// 1) Sanitização de dados (ANTES de montar o payload)
// ---------------------------------------------------------------------------

const RE_EMAIL = /@/;
const RE_EVP = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Sanitiza a Chave PIX conforme o tipo:
 *  - E-mail → minúsculo, sem espaços.
 *  - Aleatória (EVP/UUID) → mantém como está (minúsculo).
 *  - CPF / CNPJ / telefone → APENAS dígitos (remove `. / - ( ) espaço`),
 *    preservando o `+` inicial de telefone com DDI (ex.: +5586...).
 */
export function sanitizarChavePix(chave: string): string {
  const k = (chave ?? '').trim();
  if (!k) throw new Error('Chave PIX não configurada.');
  if (RE_EMAIL.test(k)) return k.replace(/\s+/g, '').toLowerCase();
  if (RE_EVP.test(k)) return k.toLowerCase();
  // Numérica (CPF/CNPJ/telefone): tira toda pontuação → só dígitos.
  const digitos = k.replace(/\D/g, '');
  return k.startsWith('+') ? `+${digitos}` : digitos;
}

/**
 * Sanitiza texto de nome/cidade: remove acentos, MAIÚSCULO, remove caracteres
 * especiais (mantém letras, dígitos e espaço) e corta no limite informado.
 */
export function sanitizarTextoEmv(texto: string, limite: number): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '') // remove caracteres especiais
    .replace(/\s+/g, ' ') // colapsa espaços
    .trim()
    .substring(0, limite);
}

/** Valor com ponto decimal e SEMPRE 2 casas (ex.: 600 → "600.00"). Null se ≤ 0. */
export function formatarValorEmv(valor?: number): string | null {
  if (valor == null || Number.isNaN(valor) || valor <= 0) return null;
  return valor.toFixed(2);
}

/** TXID (62-05): alfanumérico, sem espaços, máx. 25. Default "***" (aceito pelo BCB). */
export function sanitizarTxid(id?: string): string {
  const t = (id ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .substring(0, 25);
  return t.length > 0 ? t : '***';
}

// ---------------------------------------------------------------------------
// 2) Blocos EMV (ID + Tamanho[2 dígitos] + Valor) e CRC16
// ---------------------------------------------------------------------------

/** Monta um campo EMV: ID (2) + comprimento (2, zero-pad) + valor. */
function campo(id: string, valor: string): string {
  const len = valor.length.toString().padStart(2, '0');
  return `${id}${len}${valor}`;
}

/** CRC16-CCITT (polinômio 0x1021, init 0xFFFF) — 4 dígitos hexadecimais maiúsculos. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^  0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ---------------------------------------------------------------------------
// 3) Montagem do payload
// ---------------------------------------------------------------------------

/**
 * Gera o payload "Copia e Cola" do PIX estático já sanitizado.
 * O mesmo texto vira o QR Code no front/PDF do carnê.
 */
export function gerarPixCopiaECola(p: PixEstaticoParams): string {
  const chave = sanitizarChavePix(p.chave);
  const nome = sanitizarTextoEmv(p.nome, 25) || 'RECEBEDOR';
  const cidade = sanitizarTextoEmv(p.cidade, 15) || 'CIDADE';
  const valor = formatarValorEmv(p.valor);
  const txid = sanitizarTxid(p.identificador);

  // 26 — Merchant Account Information (arranjo Pix)
  const merchantAccount = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  // 62 — Additional Data Field Template (txid como Reference Label)
  const additionalData = campo('05', txid);

  let payload =
    campo('00', '01') + //                       Payload Format Indicator
    campo('26', merchantAccount) + //             Merchant Account Information (Pix)
    campo('52', '0000') + //                      Merchant Category Code
    campo('53', '986') + //                       Moeda: BRL (986)
    (valor ? campo('54', valor) : '') + //        Valor da transação (2 casas)
    campo('58', 'BR') + //                        País
    campo('59', nome) + //                        Nome do recebedor (≤25)
    campo('60', cidade) + //                      Cidade do recebedor (≤15)
    campo('62', additionalData); //               Dados adicionais (txid)

  // CRC16: id (63) + comprimento fixo (04) + hash sobre TUDO (inclui "6304").
  payload += '6304';
  return payload + crc16(payload);
}

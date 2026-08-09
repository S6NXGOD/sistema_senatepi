import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { tenant } from '../tenant/tenant.config';

const cache = new Map<string, Buffer | null>();

/**
 * Lê (com cache) um arquivo da pasta de assets do backend — ex.: logos para
 * embutir em PDFs. Diretório configurável via ASSETS_DIR (padrão ./assets).
 * Retorna null se o arquivo não existir, para permitir fallback seguro.
 */
export function lerAsset(nome: string): Buffer | null {
  if (cache.has(nome)) return cache.get(nome)!;
  const dir = process.env.ASSETS_DIR ?? './assets';
  let buffer: Buffer | null = null;
  try {
    buffer = readFileSync(path.resolve(dir, nome));
  } catch {
    buffer = null;
  }
  cache.set(nome, buffer);
  return buffer;
}

/**
 * O LOGO DESTA INSTALAÇÃO, para embutir em PDF.
 *
 * Existe porque sete lugares liam `'senatepi-horizontal-branco.png'` com o
 * nome cravado — carteirinha, crachá de colaborador, certificado de evento,
 * dossiê, termo de filiação e relatório de importação. Num segundo sindicato,
 * TODOS esses documentos sairiam com a marca do SENATEPI impressa, na mão dos
 * filiados do outro cliente.
 *
 * A queda para o arquivo do SENATEPI foi deliberadamente REMOVIDA: um PDF sem
 * logo é um problema visível que alguém conserta; um PDF com a marca do
 * sindicato errado passa despercebido e chega ao filiado.
 */
export function lerLogoDaMarca(): Buffer | null {
  return lerAsset(`${tenant.id}-horizontal-branco.png`);
}

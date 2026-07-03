import { readFileSync } from 'node:fs';
import * as path from 'node:path';

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

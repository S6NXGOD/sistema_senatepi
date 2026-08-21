import { ConfigService } from '@nestjs/config';
import { StorageService } from '@core/infra';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

/**
 * A GUARDA DE CAMINHO, exercitada de verdade — não só conferida no texto.
 *
 * `seguranca.spec.ts` garante que a decisão continua ESCRITA; este garante que
 * ela FUNCIONA. Os dois são necessários: um pega quem apaga a linha, o outro
 * pega quem a mantém e quebra a lógica dentro dela.
 */
describe('StorageService — escape do diretório local', () => {
  let dir: string;
  let storage: StorageService;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'senatepi-storage-'));
    const config = {
      get: (chave: string, padrao?: string) =>
        chave === 'STORAGE_DRIVER' ? 'local'
          : chave === 'STORAGE_LOCAL_DIR' ? dir
            : padrao,
    } as unknown as ConfigService;
    storage = new StorageService(config);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('grava normalmente uma chave legítima', async () => {
    await storage.upload('filiados/abc/documentos/x.pdf', Buffer.from('ok'), 'application/pdf');
    expect(existsSync(path.join(dir, 'filiados/abc/documentos/x.pdf'))).toBe(true);
  });

  /**
   * O ataque: uma chave com `..` sobe a árvore e grava fora da pasta. Hoje toda
   * chave é montada pelo servidor, então isto não é alcançável — a guarda existe
   * para o dia em que alguém montar a chave a partir de dado do usuário.
   */
  it.each([
    '../fora.txt',
    '../../fora.txt',
    'filiados/../../fora.txt',
    'filiados/abc/../../../fora.txt',
  ])('RECUSA gravar em "%s"', async (chave) => {
    await expect(
      storage.upload(chave, Buffer.from('invasao'), 'text/plain'),
    ).rejects.toThrow(/escapa do diretório/);
    expect(existsSync(path.join(path.dirname(dir), 'fora.txt'))).toBe(false);
  });

  /**
   * `getBuffer` engole erro e devolve `null` por contrato (o chamador trata
   * "arquivo ausente" como caso normal). O desfecho seguro aqui é NÃO LER —
   * e é isso que se afirma, em vez de exigir uma exceção que o método não
   * promete lançar.
   */
  it('NÃO lê fora do diretório', async () => {
    await expect(storage.getBuffer('../../../../etc/passwd')).resolves.toBeNull();
    await expect(storage.getBuffer('filiados/../../../etc/hosts')).resolves.toBeNull();
  });

  /**
   * `foo..bar` NÃO é travessia — recusá-lo seria um falso positivo que barraria
   * nome de arquivo legítimo. A guarda compara o caminho RESOLVIDO justamente
   * para não cair nesse tipo de checagem por substring.
   */
  it('não confunde ".." dentro do nome com travessia', async () => {
    await storage.upload('filiados/abc/re..latorio.pdf', Buffer.from('ok'), 'application/pdf');
    expect(existsSync(path.join(dir, 'filiados/abc/re..latorio.pdf'))).toBe(true);
  });
});

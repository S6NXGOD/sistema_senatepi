import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * NENHUM DOCUMENTO DO SISTEMA VOLTA A BAIXAR COM UUID NO NOME.
 *
 * O relato, em 31/08/2026: "ao baixar um PDF de uma atividade, ele vem com o
 * nome estranho e aleatório". Não era um caso isolado — eram OITO, todos os
 * documentos que o sistema gera:
 *
 *   carteirinha-<uuid>.pdf   cracha-<uuid>.pdf      termo-<uuid>.pdf
 *   termo-desfiliacao-<uuid>.pdf                    dossie-<uuid>.pdf
 *   certificado-<uuid>.pdf   importacao-<uuid>.pdf  presenca-<uuid>.csv
 *
 * Mais os ANEXOS, que baixavam com a chave opaca do storage.
 *
 * Este arquivo é a rede: `Content-Disposition` montado à mão volta a ser
 * pegado, e o padrão `nome-${id}` também. Um teste de texto, e de propósito —
 * o defeito não quebra nada, só entrega um arquivo com o nome errado, e é o
 * tipo de coisa que ninguém percebe até ter doze deles na pasta.
 */
const RAIZ = path.resolve(__dirname, '../..');

function fontes(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const alvo = path.join(dir, nome);
    if (statSync(alvo).isDirectory()) fontes(alvo, achados);
    else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) achados.push(alvo);
  }
  return achados;
}

const arquivos = fontes(path.join(RAIZ, 'src'));

describe('nome dos arquivos baixados', () => {
  it('a varredura achou as fontes', () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  /**
   * Todo `Content-Disposition` tem de sair de `conteudoDisposto`. Montado à
   * mão, ele perde o acento (cabeçalho é ASCII) e aceita quebra de linha vinda
   * do nome do arquivo que o usuário subiu — que é injeção de cabeçalho.
   */
  it('ninguém monta o cabeçalho à mão', () => {
    const culpados: string[] = [];
    for (const arquivo of arquivos) {
      const src = readFileSync(arquivo, 'utf8');
      for (const linha of src.split('\n')) {
        // Só interessa quem ESCREVE o cabeçalho. A declaração do CORS
        // (`exposedHeaders`) cita o mesmo nome e não monta nada.
        if (!linha.includes("setHeader('Content-Disposition'")) continue;
        if (linha.includes('conteudoDisposto')) continue;
        culpados.push(`${path.relative(RAIZ, arquivo)}: ${linha.trim()}`);
      }
    }
    expect(culpados).toEqual([]);
  });

  /** O padrão antigo, nomeado: `filename="algo-${id}.pdf"`. */
  it('nenhum nome de arquivo é montado a partir de um id', () => {
    const culpados: string[] = [];
    for (const arquivo of arquivos) {
      const src = readFileSync(arquivo, 'utf8');
      const achados = src.match(/filename="[^"]*\$\{[^}]*[Ii]d\}[^"]*"/g);
      if (achados) culpados.push(`${path.relative(RAIZ, arquivo)}: ${achados.join(', ')}`);
    }
    expect(culpados).toEqual([]);
  });

  /**
   * Os oito documentos, um por um. Um `it` por endpoint em vez de um laço:
   * quando quebrar, o nome do caso já diz qual documento perdeu o nome.
   */
  it.each([
    ['carteirinha', 'src/modules/carteirinhas/carteirinhas.module.ts', 'Carteirinha'],
    ['crachá', 'src/modules/colaboradores/colaboradores.service.ts', 'Crachá'],
    ['termo de filiação', 'src/modules/filiados/filiados.service.ts', 'Termo de Filiação'],
    ['termo de desfiliação', 'src/modules/filiados/filiados.service.ts', 'Termo de Desfiliação'],
    ['dossiê de evento', 'src/modules/eventos/dossie-evento.service.ts', 'Dossiê'],
    ['certificado', 'src/modules/eventos/certificado.service.ts', 'Certificado'],
    ['presenças (csv)', 'src/modules/eventos/presenca-lista.service.ts', 'Presenças'],
    ['relatório de importação', 'src/modules/importacao/relatorio.service.ts', 'Relatório de Importação'],
  ])('%s é nomeado por gente', (_rotulo, rel, rotuloEsperado) => {
    const src = readFileSync(path.join(RAIZ, rel), 'utf8');
    expect(src).toContain('nomeDeArquivo(');
    expect(src).toContain(`'${rotuloEsperado}'`);
  });

  /**
   * O anexo é o caso que originou o relato: o nome original está no banco
   * desde o upload e precisa viajar até a URL assinada.
   */
  it('o anexo baixa com o nome que a pessoa subiu', () => {
    const src = readFileSync(path.join(RAIZ, 'src/modules/anexos/anexos.service.ts'), 'utf8');
    // As três leituras que geram URL têm de passar o nome adiante.
    const comNome = src.match(/getSignedUrl\([^)]*nomeArquivo[^)]*\)|getSignedUrl\([^)]*nomeOriginal[^)]*\)/g) ?? [];
    expect(comNome.length).toBeGreaterThanOrEqual(3);
    expect(src).not.toMatch(/getSignedUrl\((\w+)\.storageKey\)/);
  });

  /** E o porteiro do /uploads é quem escreve o cabeçalho a partir da query. */
  it('a rota /uploads honra o nome da URL assinada', () => {
    const main = readFileSync(path.join(RAIZ, 'src/main.ts'), 'utf8');
    expect(main).toContain('conteudoDisposto(nome, modoPorExtensao(nome))');
    // Sanitizado antes de virar cabeçalho — o `nome` vem da query.
    expect(main).toContain('conteudoDisposto');
  });
});

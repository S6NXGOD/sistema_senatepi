import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * URGÊNCIA MUDA NÃO PODE VOLTAR.
 *
 * "Urgente" sem motivo é a pior marca da tela: quem abre não sabe se é regra do
 * sistema, engano de alguém ou coisa séria — e, na dúvida, aprende a ignorar a
 * marca. Foi por isso que `urgenteMotivo` nasceu obrigatório.
 *
 * Na produção de 31/08/2026 ainda havia SEIS registros urgentes sem motivo,
 * todos do robô e todos anteriores à regra. Foram tratados; este arquivo existe
 * para que a próxima gravação não recrie o problema — o defeito é do tipo que
 * ninguém percebe, porque nada quebra: só aparece uma tarja vermelha sem
 * explicação.
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

describe('quem grava urgência, grava o porquê', () => {
  const arquivos = fontes(RAIZ);

  it('a varredura achou as fontes', () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  /**
   * Procura `urgente: true` em contexto de ESCRITA. Um `select` também escreve
   * `urgente: true` — daí a exigência de que `urgenteMotivo` apareça por perto:
   * num `select` ele aparece igual, e num `data` também tem de aparecer.
   */
  it('todo `urgente: true` vem acompanhado de `urgenteMotivo`', () => {
    const faltando: string[] = [];
    for (const arquivo of arquivos) {
      const src = readFileSync(arquivo, 'utf8');
      const linhas = src.split('\n');
      linhas.forEach((linha, i) => {
        if (!/^\s*urgente: true,?\s*$/.test(linha)) return;
        // Uma janela de seis linhas para frente cobre tanto o `select` quanto o
        // bloco `data` — em ambos os casos o motivo mora ao lado.
        const janela = linhas.slice(i, i + 6).join('\n');
        if (!/urgenteMotivo/.test(janela)) {
          faltando.push(`${path.relative(RAIZ, arquivo)}:${i + 1}`);
        }
      });
    }
    expect(faltando).toEqual([]);
  });

  /**
   * `montarUrgencia` é o caminho oficial — ele carimba os quatro campos juntos
   * (`urgente`, `urgenteMotivo`, `urgenteEm`, `urgentePor`) e limpa os quatro
   * quando a urgência sai. As duas exceções que restam são HERANÇAS (a triagem
   * urgente que vira consulta, a atividade urgente que vira processo) e ambas
   * escrevem o motivo com texto de reserva.
   */
  it('as heranças de urgência sempre têm texto de reserva', () => {
    for (const rel of [
      'modules/agenda/agenda.service.ts',
      'modules/atendimentos/atendimentos.service.ts',
    ]) {
      const src = readFileSync(path.join(RAIZ, rel), 'utf8');
      expect(`${rel} tem reserva: ${/urgenteMotivo:\s*\n?\s*\S+\.urgenteMotivo \?\?/.test(src)}`)
        .toBe(`${rel} tem reserva: true`);
    }
  });
});

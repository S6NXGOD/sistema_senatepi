import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const ler = (arquivo: string) => readFileSync(path.join(__dirname, arquivo), 'utf8');
const AVISO = ler('aviso-de-choque.tsx');
const FORM = ler('compromisso-form-modal.tsx');

/**
 * CHOQUE DE HORÁRIO.
 *
 * Produção, 27/08/2026: a Dra. Margareth tinha TRÊS consultas encadeadas em
 * 31/08 — 12:00–13:00, 12:40–13:40 e 13:20–14:20. Atendimentos de uma hora
 * marcados de quarenta em quarenta minutos, e o sistema não disse nada. Um
 * advogado não se divide em dois; numa audiência a consequência é revelia.
 */
describe('aviso de choque', () => {
  it('avisa, não bloqueia — sobreposição legítima existe', () => {
    expect(AVISO).toMatch(/Dá para salvar assim mesmo/);
    // Um `disabled` aqui obrigaria a equipe a mentir a data para conseguir
    // gravar, que é o pior desfecho possível num sistema de prazos.
    expect(AVISO).not.toMatch(/disabled/);
  });

  it('some quando não há choque', () => {
    // "Sem conflitos" permanente vira ruído que a pessoa aprende a não ler — e
    // aí o dia em que houver conflito ela também não lê.
    expect(AVISO).toMatch(/if \(!data\?\.length\) return null;/);
  });

  it('não consulta antes de haver o que consultar', () => {
    expect(AVISO).toMatch(/const pronto = !!responsavelId && !!inicio && !!fim/);
    expect(AVISO).toMatch(/enabled: pronto/);
  });

  it('o cache é curto — aviso velho é pior que nenhum', () => {
    const m = AVISO.match(/staleTime: ([\d_]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ''))).toBeLessThanOrEqual(30_000);
  });

  it('o nome da atividade quebra em vez de truncar', () => {
    // É o que identifica o choque; reticências num aviso feito para ser lido
    // esvaziam o aviso.
    expect(AVISO).toContain('break-words');
  });
});

describe('o formulário consulta o choque', () => {
  it('o aviso está montado no formulário', () => {
    expect(FORM).toContain('<AvisoDeChoque');
  });

  it('na edição, a atividade não choca consigo mesma', () => {
    expect(FORM).toMatch(/ignorarId=\{editar\?\.id\}/);
  });

  /**
   * O back assume UMA HORA quando o fim não é informado (`criar`). Se o aviso
   * conferisse outro intervalo, ele checaria um horário diferente do que vai
   * ser gravado — e erraria nos dois sentidos.
   */
  it('sem fim informado, assume a mesma hora que o back assume', () => {
    const bloco = FORM.slice(FORM.indexOf('<AvisoDeChoque'), FORM.indexOf('{remarcaAviso &&'));
    expect(bloco).toContain('3600_000');
  });
});

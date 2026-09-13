import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formularioDaFoto } from './recadastro';

/**
 * A FOTO PELO LINK PEDE O DESAFIO — achado de 13/09/2026.
 *
 * Bastava o token para trocar a foto da carteirinha (e a anterior é apagada do
 * storage). A API passou a conferir cpf/dataNascimento/coren no multipart; a
 * página tem de mandá-los, senão a pessoa certa leva 403.
 */
describe('formularioDaFoto', () => {
  const foto = new Blob(['x'], { type: 'image/webp' });

  it('leva as respostas do desafio junto da foto', () => {
    const fd = formularioDaFoto(foto, { cpf: '12345678900', dataNascimento: '1980-05-10' });
    expect(fd.get('cpf')).toBe('12345678900');
    expect(fd.get('dataNascimento')).toBe('1980-05-10');
    expect(fd.has('coren')).toBe(false);
    expect(fd.get('foto')).toBeInstanceOf(Blob);
  });

  it('link sem desafio manda só a foto', () => {
    const fd = formularioDaFoto(foto, { cpf: undefined, dataNascimento: '', coren: undefined });
    expect([...fd.keys()]).toEqual(['foto']);
  });

  it('COREN vai quando é o desafio', () => {
    expect(formularioDaFoto(foto, { coren: 'COREN-PI 123-ENF' }).get('coren')).toBe('COREN-PI 123-ENF');
  });
});

describe('a página pública repassa a confirmação', () => {
  const PAGINA = readFileSync(join(__dirname, '..', 'app', 'recadastro', '[token]', 'page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('a foto e o envio usam a MESMA confirmação', () => {
    expect(PAGINA).toContain('enviarFotoRecadastro(token, foto, confirmacao)');
    expect(PAGINA).toContain('cpfConfirmacao: confirmacao.cpf,');
    expect(PAGINA).toContain('dataNascimentoConfirmacao: confirmacao.dataNascimento,');
    expect(PAGINA).toContain('corenConfirmacao: confirmacao.coren,');
  });
});

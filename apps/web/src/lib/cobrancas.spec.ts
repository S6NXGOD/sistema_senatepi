import { linkWhatsApp, mensagemCobranca } from './cobrancas';

/**
 * O BOTÃO DE COBRANÇA PELO WHATSAPP delega à regra única de `lib/whatsapp.ts`.
 *
 * A montagem antiga aceitava qualquer número de 10 dígitos e tratava o "55" do
 * começo como DDI. Estes casos são os que ela errava.
 */
describe('linkWhatsApp da cobrança', () => {
  it('celular com máscara vira o link com a mensagem', () => {
    expect(linkWhatsApp('(86) 99999-8888', 'Olá')).toBe('https://wa.me/5586999998888?text=Ol%C3%A1');
  });

  it('fixo não gera link (antes abria conversa com quem não tem WhatsApp)', () => {
    expect(linkWhatsApp('(86) 3222-1111', 'Olá')).toBeNull();
  });

  it('DDD 55 sem DDI não perde o 55 do país (antes abria a conversa errada)', () => {
    expect(linkWhatsApp('(55) 99999-8888', 'Olá')).toBe('https://wa.me/5555999998888?text=Ol%C3%A1');
  });

  it('usa o secundário quando o principal não é celular', () => {
    expect(linkWhatsApp('(86) 3222-1111', 'Olá', '86999998888')).toBe('https://wa.me/5586999998888?text=Ol%C3%A1');
  });

  it('sem telefone nenhum: null', () => {
    expect(linkWhatsApp(null, 'Olá')).toBeNull();
    expect(linkWhatsApp(undefined, 'Olá', null)).toBeNull();
  });
});

describe('mensagemCobranca', () => {
  it('sem emoji', () => {
    const m = mensagemCobranca({ nome: 'Maria Silva', vencimento: '2026-09-20', valor: 50, copiaECola: 'PIX123' });
    expect(m).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(m).toContain('20/09/2026');
    expect(m).toContain('PIX123');
  });
});

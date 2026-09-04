'use client';

/**
 * A ÚLTIMA REDE — quando quebra o próprio layout.
 *
 * `(dashboard)/error.tsx` cobre as páginas do painel e preserva o menu. Este
 * cobre o que acontece FORA dele ou no próprio layout raiz: login, recadastro
 * público, check-in de evento. Nesses casos o Next descarta a árvore inteira,
 * inclusive `<html>` — por isso este arquivo precisa renderizar as próprias
 * tags, e por isso ele não pode importar nada do sistema de design: se o que
 * quebrou foi o layout, importar componente dele é convidar a segunda queda.
 *
 * Estilo inline pelo mesmo motivo: o CSS pode não ter carregado.
 */
export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '26rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.05rem', fontWeight: 600, margin: '0 0 .5rem' }}>
            A página não carregou
          </h1>
          <p style={{ fontSize: '.875rem', lineHeight: 1.5, color: '#475569', margin: '0 0 1rem' }}>
            Alguma coisa falhou antes de a tela montar. Tentar de novo costuma resolver; se
            insistir, avise a administração informando o código abaixo.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              borderRadius: '.5rem',
              border: 'none',
              background: '#166534',
              color: '#fff',
              padding: '.6rem 1.1rem',
              fontSize: '.875rem',
              fontWeight: 500,
            }}
          >
            Tentar de novo
          </button>
          {error.digest && (
            <p
              style={{
                marginTop: '1rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '.7rem',
                color: '#64748b',
              }}
            >
              Código da falha: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}

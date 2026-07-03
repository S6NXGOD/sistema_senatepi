# Logos do SENATEPI (interface web)

Arquivos de logo servidos pelo Next.js a partir desta pasta (`apps/web/public/`), acessíveis na
raiz do site (ex.: `/senatepi-horizontal-verde.png`).

## Arquivos
| Arquivo | Uso |
|---|---|
| `senatepi-horizontal-verde.png` | Sidebar (tema claro) e login mobile |
| `senatepi-horizontal-branco.png` | Sidebar (tema escuro) e painel verde do login |
| `senatepi-vertical-verde.png` | Favicon (copiado para `apps/web/src/app/icon.png`) |
| `senatepi-vertical-branco.png` | Reserva |

O componente [Logo](../src/components/logo.tsx) troca **verde/branco** automaticamente conforme o
tema (claro/escuro) quando usado com `variant="auto"`.

> As versões brancas também ficam em `apps/api/assets/` para os PDFs. Se atualizar um logo,
> atualize nos dois lugares.

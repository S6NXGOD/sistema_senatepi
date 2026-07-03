# Logos do SENATEPI (PDFs do backend)

Os PDFs (carteirinha, crachá e termo de consentimento) embutem o logo desta pasta
(`apps/api/assets/`). Como os cabeçalhos/painéis são **verdes**, usa-se a versão **branca**.

## Arquivos usados (PNG)
| Arquivo | Uso |
|---|---|
| `senatepi-horizontal-branco.png` | Carteirinha, crachá e termo (todos os PDFs) |
| `senatepi-vertical-branco.png` | Reserva (não usado no momento) |

> Se o arquivo não existir, o PDF cai no texto "SENATEPI" (fallback), sem quebrar.
> Mantenha estes arquivos sincronizados com os de `apps/web/public/`.

## Caminho configurável
Lido a partir de `ASSETS_DIR` (padrão `./assets`, relativo ao diretório da API). Em produção,
publique esta pasta junto ou defina `ASSETS_DIR` para o caminho absoluto.

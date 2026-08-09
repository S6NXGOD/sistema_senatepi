# Logos dos PDFs do backend

Os PDFs gerados pela API — carteirinha, crachá, certificado de evento, dossiê,
termo de filiação e relatório de importação — embutem o logo desta pasta
(`apps/api/assets/`). Como os cabeçalhos são pintados com a cor da marca,
usa-se a versão **branca**.

## Convenção de nome

    <id-do-cliente>-horizontal-branco.png

`senatepi-horizontal-branco.png`, `sindserm-horizontal-branco.png`, e assim por
diante. O `id` é o do `tenant.config` — o mesmo valor da variável `TENANT`.

**Isto não é organização, é isolamento.** Os seis lugares que geram PDF liam
`'senatepi-horizontal-branco.png'` com o nome escrito à mão. Num segundo
sindicato, a carteirinha, o certificado e o termo dos filiados DELE sairiam com
a marca do SENATEPI impressa. Hoje todos passam por `lerLogoDaMarca()`, que
monta o nome a partir da instalação.

## Se o arquivo não existir

O PDF sai **sem logo**. A queda para o arquivo do SENATEPI foi removida de
propósito: documento sem logo é um problema visível, que alguém conserta;
documento com a marca do sindicato errado passa despercebido e chega ao
filiado.

## Caminho configurável

Lido a partir de `ASSETS_DIR` (padrão `./assets`, relativo ao diretório da API).
Em produção, publique esta pasta junto ou aponte `ASSETS_DIR` para um caminho
absoluto. Mantenha os arquivos sincronizados com os de `apps/web/public/`.

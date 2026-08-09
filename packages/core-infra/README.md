# @core/infra

Infraestrutura compartilhada entre as instalações: armazenamento de arquivos e
imagens, QR Code assinado e utilitários puros.

## Por que este pacote existe, e por que ele veio primeiro

É a parte do sistema com **zero acoplamento ao domínio**: nada aqui sabe o que é
um filiado, um processo ou um sindicato. Por isso foi o escolhido para provar a
mecânica do monorepo — se um pacote compartilhado funcionasse mal (build,
resolução de caminho em runtime, metadado de decorador do Nest atravessando a
fronteira do pacote), era melhor descobrir aqui do que ao mover o módulo
jurídico inteiro.

Os três riscos foram testados de verdade, não deduzidos:

| Risco | Como foi verificado |
|---|---|
| O TypeScript acha os tipos | `npx tsc --noEmit` na API, limpo |
| O Node acha o código em produção | `node dist/src/main.js` sobe e resolve `@core/infra` pelo symlink do workspace |
| A injeção de dependência do Nest atravessa o pacote | a API compilada **subiu inteira**, com `StorageService`/`QrCodeService` injetados |

## O que NÃO entra aqui

Qualquer coisa que conheça uma tabela **de domínio**. `AuditService`, por
exemplo, ficou de fora justamente por depender de `PrismaService` e escrever em
`logs_auditoria` — ele pertence a um pacote de domínio.

**Uma exceção consciente:** `trava-job.util.ts` recebe um `PrismaClient` e usa a
tabela `travas_job`. Ela é infraestrutura, não domínio — nenhum sindicato tem
opinião sobre ela —, mas isso cria um contrato real: **toda instalação precisa
ter `travas_job` no schema**. Está escrito aqui porque é o tipo de dependência
que some do radar até o dia em que o cron de um cliente novo falha.

## Consumo

```ts
import { StorageService, QrCodeService, normalizarBusca } from '@core/infra';
```

Sempre pelo barril (`@core/infra`), nunca por caminho interno — assim mover um
arquivo aqui dentro não quebra nenhum app.

## Build

O pacote compila para `dist/` e é isso que o Node carrega em produção. O app não
precisa lembrar disso: `apps/api` tem um `prebuild` que compila este pacote
antes de si mesmo, então o `buildCommand` do Railway continua sendo só
`npm run build --workspace=@senatepi/api`.

Nos **testes** é o contrário: `apps/api/jest.config.js` mapeia `@core/infra` para
o **fonte**. Sem isso os testes da API rodariam contra o `dist/` anterior e
passariam verde depois de uma alteração quebrada no core.

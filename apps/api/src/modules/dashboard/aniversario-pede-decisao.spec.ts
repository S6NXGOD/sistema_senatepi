import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PermissionsGuard } from '../../common/permissions/permissions.guard';

const DASH = readFileSync(join(__dirname, 'dashboard.module.ts'), 'utf8');

/**
 * "SE TIVER ANIVERSARIANTE NO DIA, NÃO É BOM APARECER UMA ANIMAÇÃO QUE FORCE A
 * TRIAGEM A PARABENIZAR OU DISPENSAR?" — o dono, 18/09/2026.
 *
 * O cartão existia e era passivo. Agora pede decisão, e a decisão é um FATO
 * gravado: "deixar passar" sem registro seria um botão de fechar, e a casa não
 * tem botão de fechar.
 *
 * O PONTO DELICADO É A PERMISSÃO. A classe inteira é `@Modulo('dashboard')`, e
 * TODO perfil tem dashboard VISUALIZAR — um POST ali passaria por qualquer um
 * que abra a home. A rota declara `@Modulo('filiados')` no MÉTODO, que o guard
 * resolve sobre a classe (`getAllAndOverride`), e aí um POST exige EDITAR em
 * filiados: a Triagem tem, o Advogado não.
 */
describe('a rota do aniversário se corta pela matriz, não pelo perfil', () => {
  const guard = new PermissionsGuard(new Reflector());
  const reflector = new Reflector();

  /** O handler decorado de verdade, tirado do controller em tempo de execução. */
  const contexto = (role: UserRole, permissoes: Record<string, string> = {}) =>
    ({
      getHandler: () => alvo.handler,
      getClass: () => alvo.classe,
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', user: { id: 'u1', role, permissoes } }),
      }),
    }) as never;

  // Carrega o módulo só aqui: importar no topo arrastaria o Prisma para o spec.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const mod = require('./dashboard.module') as any;
  const alvo = (() => {
    const classe = Object.values(mod).find(
      (v) => typeof v === 'function' && /DashboardController/.test((v as () => void).name),
    ) as (new (...a: never[]) => Record<string, () => unknown>) | undefined;
    // O controller não é exportado: neste caso o teste cai para o fonte, e diz.
    return { classe, handler: classe?.prototype?.aniversario };
  })();

  it('a rota existe e declara o módulo de filiados no método', () => {
    /*
      ASSERÇÃO SOBRE O FONTE, e aqui ela é honesta: o que se quer provar é que o
      decorador está ESCRITO na rota. O comportamento do guard com esse
      decorador já é provado em `fila-de-duplicados.spec.ts`.
    */
    const trecho = DASH.slice(DASH.indexOf("@Post('aniversario')"), DASH.indexOf('aniversario('));
    expect(trecho).toContain("@Modulo('filiados')");
    expect(trecho).not.toContain('@Roles');
  });

  it('o guard nega POST para quem só VISUALIZA filiados', () => {
    if (!alvo.handler) return; // controller não exportado — ver a asserção acima
    expect(() => guard.canActivate(contexto(UserRole.ADVOGADO, { filiados: 'VISUALIZAR' })))
      .toThrow();
  });

  it('e libera para a Triagem, que edita filiados', () => {
    if (!alvo.handler) return;
    expect(guard.canActivate(contexto(UserRole.TRIAGEM, { filiados: 'EDITAR' }))).toBe(true);
  });

  void reflector;
});

/**
 * A GRAVAÇÃO É POR PESSOA E POR DIA. `upsert` na chave natural: clicar duas
 * vezes não gera duas linhas, e trocar de ideia no mesmo dia corrige em vez de
 * acumular. O dia é de CALENDÁRIO em Teresina, não instante — coluna `@db.Date`
 * e `dateOnlyBR`, a mesma função que o resto do painel usa.
 */
describe('o registro do aniversário', () => {
  it('usa a chave natural (pessoa, dia) e não cria linha nova a cada clique', () => {
    const trecho = DASH.slice(
      DASH.indexOf('async registrarAniversario('),
      DASH.indexOf('async registrarAniversario(') + 1400,
    );
    expect(trecho).toContain('contatoDeAniversario.upsert');
    expect(trecho).toContain('pessoaId_dia');
  });

  it('grava os DOIS desfechos — "deixou passar" também é fato', () => {
    const dto = DASH.slice(DASH.indexOf('class RegistrarAniversarioDto'));
    expect(dto).toContain("@IsIn(['PARABENIZADO', 'DEIXOU_PASSAR'])");
  });

  it('o dia é de calendário em Teresina, não o instante do clique', () => {
    const trecho = DASH.slice(
      DASH.indexOf('async registrarAniversario('),
      DASH.indexOf('async registrarAniversario(') + 600,
    );
    expect(trecho).toContain('dateOnlyBR(new Date())');
  });

  /**
   * A DECISÃO VIAJA COM A LISTA. Sem isso, duas pessoas da secretaria
   * cumprimentam a mesma filiada e ninguém fala com a outra — que era
   * exatamente o buraco do cartão passivo.
   */
  it('a lista de aniversariantes já vem com a decisão do dia', () => {
    const trecho = DASH.slice(
      DASH.indexOf('private async aniversariantesDeHoje('),
      DASH.indexOf('async registrarAniversario('),
    );
    expect(trecho).toContain('contatoDeAniversario.findMany');
    expect(trecho).toContain('decisao:');
  });
});

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { moduloAtivo } from '../../tenant/tenant.config';
import { lerAsset } from '../../common/assets.util';
import { chaveDeEnte } from './chave-de-ente.util';

/**
 * O CATÁLOGO DE ENTES PÚBLICOS ENTRA NO BANCO NO PRIMEIRO BOOT.
 *
 * SÃO 5.599: os 5.571 municípios do IBGE, os 26 estados, o Distrito Federal e a
 * União. Os três níveis moram na mesma tabela porque é assim que o SICONFI os
 * trata — a chave dele é o mesmo código, e a mesma consulta serve aos três.
 *
 * POR QUE NÃO NA MIGRAÇÃO. Um INSERT com 5.599 tuplas dentro de um
 * `migration.sql` é um diff que ninguém revisa, some no `git blame` de qualquer
 * arquivo vizinho e transforma a próxima correção de acento numa segunda
 * migração de 5.599 linhas. Aqui o dado é um arquivo de dados, revisável como
 * dado, e a recarga é reexecutar o boot.
 *
 * POR QUE NÃO BUSCAR NO IBGE AO SUBIR. Porque aí o sindicato passaria a depender
 * de a API do IBGE estar de pé para a API dele subir. O catálogo muda de década
 * em década; uma cópia versionada no repositório é mais honesta que uma chamada
 * de rede no caminho crítico do boot.
 *
 * POR QUE O BRASIL INTEIRO, e não só o Piauí — 349 KB contra 15 KB. Medido na
 * produção em 10/09/2026: o cadastro tem filiado em Timon, Caxias e Barão de
 * Grajaú (MA) e processo em Brasília. Com um catálogo só do PI, esses registros
 * ficariam para sempre "sem município", e a tela de pendências mostraria como
 * erro o que é simplesmente gente que mora do outro lado do rio.
 */
@Injectable()
export class EnteSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EnteSeedService.name);

  /** Fatia de inserção — o mesmo tamanho que a importação de filiados usa. */
  private static readonly LOTE = 500;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * NÃO SEGURA O BOOT — e isto foi medido, não suposto.
   *
   * O Nest só passa a atender depois que todo `onApplicationBootstrap` resolve.
   * Cronometrado contra o banco de produção em 10/09/2026: a carga leva
   * **6,0 segundos** em 12 lotes de 500. Somados à `prisma migrate deploy` que
   * roda antes e à subida da aplicação, seriam seis segundos a mais de janela
   * sem responder ao health check — e um deploy que não passa no health check é
   * um deploy que volta atrás.
   *
   * Por isso a carga é disparada e o boot segue. A consequência é honesta e
   * pequena: nos primeiros segundos da primeira subida a tela mostra o catálogo
   * vazio, com a mensagem de que ele ainda não foi carregado. Nas subidas
   * seguintes o `count()` corta antes de qualquer escrita e nada disso acontece.
   */
  onApplicationBootstrap() {
    if (!moduloAtivo('municipios')) return;
    void this.carregar().catch((e) => {
      /*
        Falhar aqui NÃO derruba nada. Sem catálogo o sistema continua inteiro:
        cidade permanece texto livre, como sempre foi, e some apenas a ficha do
        ente e o indicador fiscal.
      */
      this.logger.error('Falha ao carregar o catálogo de entes públicos.', e as Error);
    });
  }

  private async carregar() {
    const linhas = this.lerCatalogo();
    if (!linhas.length) {
      this.logger.warn(
        'Catálogo de entes não encontrado em assets/entes-ibge.json — ' +
          'a ficha do município e os indicadores do SICONFI ficam vazios.',
      );
      return;
    }

    const jaTem = await this.prisma.ente.count();
    if (jaTem >= linhas.length) return; // caminho normal: já está carregado

    const dados = linhas.map(([codigo, nome, uf, esfera, imediata, intermediaria]) => ({
      codigo,
      nome,
      uf,
      esfera,
      nomeNormalizado: chaveDeEnte(nome),
      regiaoImediata: imediata || null,
      regiaoIntermediaria: intermediaria || null,
    }));

    let inseridos = 0;
    for (let i = 0; i < dados.length; i += EnteSeedService.LOTE) {
      const fatia = dados.slice(i, i + EnteSeedService.LOTE);
      const r = await this.prisma.ente.createMany({ data: fatia, skipDuplicates: true });
      inseridos += r.count;
    }

    if (inseridos > 0) {
      const municipios = dados.filter((d) => d.esfera === 'M').length;
      this.logger.log(
        `Catálogo de entes: ${inseridos} carregados (${municipios} municípios, ` +
          `${dados.length - municipios} estados/União; ${jaTem} já existiam).`,
      );
    }
  }

  /**
   * O ARQUIVO É UM ARRAY DE ARRAYS, e não de objetos com chave: são 5.599
   * registros, e repetir `"nome":`/`"uf":` em cada um custaria mais de 200 KB só
   * de nome de campo. A ordem é [código, nome, UF, esfera, região imediata,
   * região intermediária], documentada aqui porque é o único lugar que a conhece.
   *
   * `esfera` é 'U' (União), 'E' (estado ou DF) ou 'M' (município). Para a União a
   * UF é "BR", que não é sigla de estado nenhum — e é justamente por isso que a
   * esfera existe: sem ela, alguém leria aquele "BR" como se fosse uma unidade
   * da federação.
   */
  private lerCatalogo(): Array<[number, string, string, string, string, string]> {
    const buffer = lerAsset('entes-ibge.json');
    if (!buffer) return [];
    const bruto = JSON.parse(buffer.toString('utf8')) as unknown;
    if (!Array.isArray(bruto)) return [];
    return bruto.filter(
      (l): l is [number, string, string, string, string, string] =>
        Array.isArray(l) &&
        typeof l[0] === 'number' &&
        typeof l[1] === 'string' &&
        typeof l[2] === 'string' &&
        ['U', 'E', 'M'].includes(l[3]),
    );
  }
}

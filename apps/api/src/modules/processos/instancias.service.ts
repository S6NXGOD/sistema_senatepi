import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InstanciaDatajud, MovimentacaoDatajud } from './datajud.service';
import { classificarAudiencia, instanciaBaixada } from './utils/audiencia.util';
import { escolherPrincipal } from './utils/instancia.util';

/**
 * Grava e mantém as INSTÂNCIAS (graus) de um processo.
 *
 * POR QUE UM SERVIÇO PRÓPRIO
 * A regra é pequena mas tem três invariantes que não podem escapar, e
 * espalhá-las pelo `ProcessosService` (já com 870 linhas) é como elas se
 * perderiam:
 *
 *  1. a instância é identificada pelo `docId` do CNJ — nunca recriada;
 *  2. existe no máximo UMA principal por processo (há índice único parcial no
 *     banco cobrando isso, e ele não tolera duas verdadeiras nem por um
 *     instante dentro da transação);
 *  3. os campos de `Processo` que descrevem o grau (tribunal, classe, órgão…)
 *     são ATALHOS da principal — mesma regra que já vale para
 *     `filiadoId`/`advogadoId`, e o único escritor é este serviço.
 *
 * A dedução de "qual é a principal" mora em `utils/instancia.util.ts`, função
 * pura e testada: é a regra mais fácil de errar e a que decide se um processo
 * continua sendo monitorado.
 */
@Injectable()
export class InstanciasService {
  private readonly logger = new Logger(InstanciasService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reconcilia as instâncias devolvidas pelo CNJ com as gravadas, e devolve o
   * total de movimentações novas.
   *
   * Roda DENTRO da transação do chamador (recebe `tx`): instância, movimentação
   * e atalhos precisam entrar juntos, ou um processo pode ficar com andamento
   * apontando para instância que não existe.
   */
  async sincronizar(
    tx: Prisma.TransactionClient,
    processoId: string,
    instanciasDoCnj: InstanciaDatajud[],
  ): Promise<{ novas: number; enriquecidas: number }> {
    if (!instanciasDoCnj.length) return { novas: 0, enriquecidas: 0 };

    await this.reconciliarInstanciaHerdada(tx, processoId, instanciasDoCnj);

    /**
     * A instância herdada do backfill guarda o histórico do PROCESSO INTEIRO —
     * a migração apontou para ela todos os andamentos, porque naquele momento
     * só existia uma. Quando o CNJ passa a devolver dois graus, os andamentos do
     * outro grau seriam inseridos DE NOVO na instância nova (a chave de
     * deduplicação é por instância, de propósito: dois graus praticam atos
     * homônimos). Resultado medido em produção: 148 atos duplicados num único
     * processo, contagem inflada e a linha do tempo mostrando tudo duas vezes.
     *
     * Aqui os andamentos são MOVIDOS para a instância a que pertencem, antes da
     * mesclagem — nada é apagado, e a mesclagem seguinte encontra cada ato onde
     * ele deve estar e não duplica.
     */
    const idPorDoc = new Map<string, string>();
    for (const doCnj of instanciasDoCnj) {
      idPorDoc.set(doCnj.docId, await this.upsertInstancia(tx, processoId, doCnj));
    }
    if (instanciasDoCnj.length > 1) {
      await this.redistribuirAndamentos(tx, processoId, instanciasDoCnj, idPorDoc);
    }

    let novas = 0;
    let enriquecidas = 0;

    for (const doCnj of instanciasDoCnj) {
      const instanciaId = idPorDoc.get(doCnj.docId)!;
      const r = await this.mesclarMovimentacoes(tx, processoId, instanciaId, doCnj.movimentacoes);
      novas += r.novas;
      enriquecidas += r.enriquecidas;

      // `ultimo_movimento_em` e `baixada` são derivados do que ACABOU de entrar,
      // então são calculados depois da mesclagem — e a partir do banco, não do
      // payload: o CNJ pode devolver menos movimentos do que já temos gravado
      // (acontece quando o tribunal reprocessa o índice), e usar só o payload
      // faria uma instância viva parecer parada.
      await this.recalcularDerivados(tx, instanciaId);
    }

    await this.definirPrincipal(tx, processoId);
    return { novas, enriquecidas };
  }

  /**
   * Adota a instância criada pelo BACKFILL, em vez de criar uma segunda ao lado.
   *
   * O PROBLEMA QUE ISTO EVITA
   * A migração deu a cada processo já existente uma instância, com o `docId`
   * REMONTADO a partir do que estava gravado: `<TRIBUNAL>_<GRAU>_<NPU>`. Isso
   * casa com o `_id` real do CNJ na esmagadora maioria dos casos — mas não em
   * todos: se o processo foi importado sem `grau` (o CNJ pode omitir o campo), o
   * backfill chutou "G1". Sendo o processo, na verdade, de 2º grau, o `docId`
   * remontado não casaria com nada, e a primeira sincronização criaria uma
   * SEGUNDA instância — trazendo os mesmos andamentos de novo, agora sob outra
   * instância. O processo passaria a exibir o histórico em dobro.
   *
   * A REGRA: um processo com UMA instância gravada, e o CNJ devolvendo UMA
   * instância, são necessariamente a mesma coisa — não existe ambiguidade
   * possível. Então o `docId` (e o grau) da linha existente são corrigidos para
   * os verdadeiros, e o histórico dela é preservado no lugar.
   *
   * Só age nesse caso exato. Com duas ou mais instâncias de qualquer lado, o
   * casamento por `docId` já é confiável e mexer seria adivinhação.
   */
  /**
   * Põe cada andamento na instância a que ele pertence, segundo o CNJ.
   *
   * Só age sobre o que está no lugar errado: monta a chave (data|código|
   * descrição) de cada instância a partir do payload e move o andamento cuja
   * instância atual não corresponde. Ato que aparece nos DOIS graus (homônimo,
   * praticado de verdade em ambos) fica onde está — mover seria trocar um erro
   * por outro.
   */
  private async redistribuirAndamentos(
    tx: Prisma.TransactionClient,
    processoId: string,
    instanciasDoCnj: InstanciaDatajud[],
    idPorDoc: Map<string, string>,
  ): Promise<void> {
    const chave = (dm: Date | string, cod: number | null | undefined, desc: string) =>
      `${new Date(dm).getTime()}|${cod ?? ''}|${desc}`;

    /** chave do ato → instâncias do CNJ que o contêm. */
    const donos = new Map<string, string[]>();
    for (const inst of instanciasDoCnj) {
      const id = idPorDoc.get(inst.docId);
      if (!id) continue;
      for (const m of inst.movimentacoes) {
        const k = chave(m.dataMovimento, m.codigoMovimento, m.descricao);
        const lista = donos.get(k);
        if (lista) { if (!lista.includes(id)) lista.push(id); } else donos.set(k, [id]);
      }
    }

    const gravadas = await tx.movimentacaoProcessual.findMany({
      where: { processoId },
      select: { id: true, instanciaId: true, dataMovimento: true, codigoMovimento: true, descricao: true },
    });

    let movidos = 0;
    for (const m of gravadas) {
      const lista = donos.get(chave(m.dataMovimento, m.codigoMovimento, m.descricao));
      // Ato que o CNJ não devolve mais (índice reprocessado) fica onde está:
      // apagar ou mover às cegas perderia histórico que só nós temos.
      if (!lista || lista.length !== 1) continue;
      if (m.instanciaId === lista[0]) continue;
      await tx.movimentacaoProcessual.update({
        where: { id: m.id },
        data: { instanciaId: lista[0] },
      });
      movidos++;
    }
    if (movidos) {
      this.logger.log(
        `[INSTANCIAS] Processo ${processoId}: ${movidos} andamento(s) realocado(s) para a instância correta.`,
      );
    }
  }

  private async reconciliarInstanciaHerdada(
    tx: Prisma.TransactionClient,
    processoId: string,
    instanciasDoCnj: InstanciaDatajud[],
  ): Promise<void> {
    if (instanciasDoCnj.length !== 1) return;

    const gravadas = await tx.processoInstancia.findMany({
      where: { processoId },
      select: { id: true, docId: true, grau: true },
    });
    if (gravadas.length !== 1) return;

    const gravada = gravadas[0];
    const doCnj = instanciasDoCnj[0];
    if (gravada.docId === doCnj.docId) return; // já é a mesma linha

    await tx.processoInstancia.update({
      where: { id: gravada.id },
      data: { docId: doCnj.docId, grau: (doCnj.grau ?? gravada.grau).toUpperCase() },
    });
    this.logger.log(
      `[INSTANCIAS] Processo ${processoId}: instância herdada "${gravada.docId}" ` +
        `reconhecida como "${doCnj.docId}" — histórico preservado.`,
    );
  }

  /**
   * Cria ou atualiza a instância pelo par (processo, docId).
   *
   * `principal` NÃO é escrito aqui — quem decide é `definirPrincipal`, depois de
   * todas as instâncias estarem gravadas. Escrever a principal no meio do laço
   * violaria o índice único assim que a segunda instância chegasse.
   */
  private async upsertInstancia(
    tx: Prisma.TransactionClient,
    processoId: string,
    d: InstanciaDatajud,
  ): Promise<string> {
    const dados = {
      grau: (d.grau ?? 'G1').toUpperCase(),
      tribunal: (d.tribunal ?? '').toUpperCase() || 'ND',
      classeProcessual: d.classeProcessual,
      classeCodigo: d.classeCodigo,
      orgaoJulgador: d.orgaoJulgador,
      orgaoJulgadorCodigo: d.orgaoJulgadorCodigo,
      dataDistribuicao: d.dataDistribuicao ? new Date(d.dataDistribuicao) : null,
      nivelSigilo: d.nivelSigilo,
      // Assuntos POR INSTÂNCIA: eles mudam entre os graus (o 1º trata de
      // insalubridade e o 2º da multa do FGTS, no mesmo processo), e guardar só
      // os de uma instância perdia os demais — e com eles a etiqueta de perícia.
      assuntos: (d.assuntos ?? []) as unknown as Prisma.InputJsonValue,
      assuntoPrincipal: d.assuntoPrincipal,
      formato: d.formato,
      sistema: d.sistema,
      atualizadoNoCnjEm: d.atualizadoNoCnjEm ? new Date(d.atualizadoNoCnjEm) : null,
      ultimaSincronizacao: new Date(),
    };

    const instancia = await tx.processoInstancia.upsert({
      where: { processoId_docId: { processoId, docId: d.docId } },
      create: { processoId, docId: d.docId, ...dados },
      update: dados,
      select: { id: true },
    });
    return instancia.id;
  }

  /**
   * Insere as movimentações ausentes desta instância e enriquece as que já
   * existiam sem detalhamento.
   *
   * A chave de igualdade é (data, código TPU, descrição) DENTRO DA INSTÂNCIA —
   * a mesma do índice único do banco. Escopo de instância e não de processo
   * porque o 1º e o 2º grau praticam atos homônimos ("Conclusão", TPU 51) e
   * tratá-los como o mesmo fato apagaria o andamento de um dos dois.
   */
  private async mesclarMovimentacoes(
    tx: Prisma.TransactionClient,
    processoId: string,
    instanciaId: string,
    doCnj: MovimentacaoDatajud[],
  ): Promise<{ novas: number; enriquecidas: number }> {
    const gravadas = await tx.movimentacaoProcessual.findMany({
      where: { instanciaId },
      select: {
        id: true, dataMovimento: true, descricao: true, codigoMovimento: true,
        detalhe: true, complementos: true,
      },
    });

    /**
     * A chave inclui o DETALHE, e não é preciosismo.
     *
     * O CNJ devolve, com o MESMO carimbo de tempo, código e nome, movimentos que
     * dizem coisas opostas. Medido no 0000600-48.2023.5.22.0108 em 07/08/2026:
     *
     *   2023-11-30T11:43:04  cod 12747 "Inicial"  situacao_da_audiencia=designada
     *   2023-11-30T11:43:04  cod 12747 "Inicial"  situacao_da_audiencia=cancelada
     *
     * São dois fatos — a designação e o cancelamento —, registrados no mesmo
     * instante pelo tribunal. Deduplicando só por (data, código, nome), um dos
     * dois era descartado, e QUAL deles sobrevivia dependia da ordem em que o
     * Elasticsearch os devolvesse. Ou seja: uma audiência cancelada podia ficar
     * gravada como designada, e o advogado ser mandado a uma audiência que não
     * existe — ou o contrário, que é pior.
     *
     * `detalhe` é justamente o texto montado a partir dos complementos
     * (`montarDetalhe`), então distingue os dois sem inventar campo novo.
     */
    const chave = (
      dm: Date | string,
      cod: number | null | undefined,
      desc: string,
      detalhe?: string | null,
    ) => `${new Date(dm).getTime()}|${cod ?? ''}|${desc}|${detalhe ?? ''}`;
    const porChave = new Map(
      gravadas.map((m) => [chave(m.dataMovimento, m.codigoMovimento, m.descricao, m.detalhe), m]),
    );

    const novas = doCnj.filter(
      (m) => !porChave.has(chave(m.dataMovimento, m.codigoMovimento, m.descricao, m.detalhe)),
    );

    if (novas.length) {
      await tx.movimentacaoProcessual.createMany({
        data: novas.map((m) => this.paraLinha(processoId, instanciaId, m)),
        // Cinto de segurança sobre o índice único: se duas sincronizações
        // escaparem da trava de job e coincidirem, a segunda ignora em vez de
        // derrubar a transação inteira com violação de unicidade.
        skipDuplicates: true,
      });
    }

    // RE-INDEXAÇÃO AUTO-CORRETIVA: a mesclagem só INSERE, então movimentações
    // gravadas antes de o detalhamento existir ficariam cruas para sempre.
    // Idempotente — na próxima sincronização nada mais se qualifica.
    let enriquecidas = 0;
    for (const m of doCnj) {
      const atual = porChave.get(chave(m.dataMovimento, m.codigoMovimento, m.descricao, m.detalhe));
      if (!atual) continue;
      const temNovidade =
        m.complementos.length > 0 || !!m.detalhe || !!m.conteudo || !!m.orgaoJulgador;
      if (!temNovidade) continue;
      const mudou =
        atual.detalhe !== m.detalhe ||
        JSON.stringify(atual.complementos ?? null) !== JSON.stringify(m.complementos ?? []);
      if (!mudou) continue;

      await tx.movimentacaoProcessual.update({
        where: { id: atual.id },
        data: {
          complementos: (m.complementos ?? []) as unknown as Prisma.InputJsonValue,
          detalhe: m.detalhe,
          conteudo: m.conteudo,
          orgaoJulgador: m.orgaoJulgador,
        },
      });
      enriquecidas++;
    }

    return { novas: novas.length, enriquecidas };
  }

  /**
   * Recalcula `ultimo_movimento_em` e `baixada` a partir do que está gravado.
   *
   * `ultimo_movimento_em` é o que decide qual instância representa o processo —
   * e precisa vir dos movimentos, NÃO de `atualizado_no_cnj_em`. Aquele campo é
   * o carimbo de ingestão do CNJ: no NPU 0831236-24.2023.8.18.0140 os dois graus
   * vêm com a mesma data, enquanto o último ato real era de 2026-05 no G2 e
   * 2025-11 no G1. Escolher por ele erraria de forma consistente.
   */
  private async recalcularDerivados(tx: Prisma.TransactionClient, instanciaId: string) {
    const movimentos = await tx.movimentacaoProcessual.findMany({
      where: { instanciaId },
      select: { dataMovimento: true, codigoMovimento: true },
      orderBy: { dataMovimento: 'desc' },
    });

    await tx.processoInstancia.update({
      where: { id: instanciaId },
      data: {
        ultimoMovimentoEm: movimentos[0]?.dataMovimento ?? null,
        baixada: instanciaBaixada(movimentos),
      },
    });
  }

  /**
   * Elege a instância principal e propaga os atalhos para `Processo`.
   *
   * A ordem importa: zera todas as principais ANTES de marcar a nova. O índice
   * único parcial (`processos_instancias_principal_key`) não tolera duas
   * verdadeiras nem por um instante dentro da transação — mesma armadilha já
   * documentada em `PartesService.definirAdvogados`.
   */
  async definirPrincipal(tx: Prisma.TransactionClient, processoId: string): Promise<void> {
    const instancias = await tx.processoInstancia.findMany({
      where: { processoId },
      select: {
        id: true, docId: true, grau: true, tribunal: true, baixada: true,
        ultimoMovimentoEm: true, classeProcessual: true, classeCodigo: true,
        orgaoJulgador: true, orgaoJulgadorCodigo: true, dataDistribuicao: true,
        nivelSigilo: true, formato: true, sistema: true, atualizadoNoCnjEm: true,
      },
    });
    if (!instancias.length) return;

    const principal = escolherPrincipal(instancias);
    if (!principal) return;

    await tx.processoInstancia.updateMany({
      where: { processoId, principal: true },
      data: { principal: false },
    });
    await tx.processoInstancia.update({
      where: { id: principal.id },
      data: { principal: true },
    });

    // Atalhos: a lista, o dashboard e o radar leem daqui com WHERE indexado,
    // sem join. Este é o ÚNICO lugar que os escreve.
    await tx.processo.update({
      where: { id: processoId },
      data: {
        grau: principal.grau,
        tribunal: principal.tribunal,
        classeProcessual: principal.classeProcessual,
        classeCodigo: principal.classeCodigo,
        orgaoJulgador: principal.orgaoJulgador,
        orgaoJulgadorCodigo: principal.orgaoJulgadorCodigo,
        dataDistribuicao: principal.dataDistribuicao,
        nivelSigilo: principal.nivelSigilo,
        formato: principal.formato,
        sistema: principal.sistema,
        atualizadoNoCnjEm: principal.atualizadoNoCnjEm,
      },
    });

    if (instancias.length > 1) {
      this.logger.log(
        `[INSTANCIAS] Processo ${processoId}: ${instancias.length} instância(s) — ` +
          `principal ${principal.grau}` +
          (instancias.some((i) => i.baixada)
            ? ` (baixadas: ${instancias.filter((i) => i.baixada).map((i) => i.grau).join(', ')})`
            : ''),
      );
    }
  }

  /**
   * Movimentação do DataJud → linha do cache local, já CLASSIFICADA pelo radar
   * de audiências. Classificar na escrita mantém o alerta do dashboard barato:
   * a leitura vira um filtro indexado, sem varrer texto.
   */
  private paraLinha(processoId: string, instanciaId: string, m: MovimentacaoDatajud) {
    const dataMovimento = new Date(m.dataMovimento);
    // O classificador enxerga também o detalhe/teor: "Expedição de documento"
    // sozinho não diz nada, mas "— Mandado de Intimação de Audiência" diz.
    const textoCompleto = [m.descricao, m.detalhe, m.conteudo].filter(Boolean).join(' — ');
    const { ehAudiencia, audienciaData } = classificarAudiencia(
      textoCompleto,
      m.codigoMovimento,
      dataMovimento,
      // Os complementos tabelados carregam `situacao_da_audiencia` — o sinal
      // mais confiável de pauta que o CNJ dá, e que o texto não tem.
      m.complementos,
    );
    return {
      processoId,
      instanciaId,
      dataMovimento,
      descricao: m.descricao,
      codigoMovimento: m.codigoMovimento,
      complementos: (m.complementos ?? []) as unknown as Prisma.InputJsonValue,
      detalhe: m.detalhe,
      conteudo: m.conteudo,
      orgaoJulgador: m.orgaoJulgador,
      ehAudiencia,
      audienciaData,
    };
  }
}

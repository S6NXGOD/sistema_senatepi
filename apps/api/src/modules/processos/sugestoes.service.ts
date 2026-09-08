import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StatusSugestaoProcesso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { nossoPoloNoAto } from './utils/acao-nossa.util';
import { fecharTarefaDeCadastro } from './utils/tarefa-de-cadastro.util';

/** O recorte do DTO de importação que o lote precisa preencher. */
export interface ImportarEmLoteItem {
  numeroCNJ: string;
  tribunal?: string;
  /** O advogado que o próprio ato nomeia — o primeiro responde. */
  advogadoId?: string;
  advogadosIds?: string[];
  poloAtivo: {
    tipo: 'INSTITUCIONAL' | 'FILIADOS' | 'OUTRA';
    partes: { tipo: 'INSTITUCIONAL' | 'AVULSA'; nome?: string }[];
  };
  partesContrarias: { nome: string }[];
}

/**
 * A FILA DE AÇÕES QUE O DIÁRIO REVELOU E O ACERVO NÃO CONHECE.
 *
 * Quem alimenta é o `DjenSyncService`: no ponto em que a ingestão descartava
 * tudo que não casava com um processo cadastrado, ele agora separa o que nomeia
 * o sindicato entre os destinatários. Este serviço é só a leitura e as duas
 * decisões possíveis — cadastrar ou ignorar.
 */
/**
 * Nome comparável — MESMA régua do `comparavel` de `PartesService`.
 *
 * Sem acento, sem pontuação, sem caixa e sem espaço. Os dois lados precisam
 * concordar sobre o que é "a mesma parte": se a régua daqui fosse mais frouxa,
 * o lote reaproveitaria um cadastro que a tela consideraria outro.
 */
function comparavelNome(nome: string): string {
  return (nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class SugestoesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A FILA SE FECHA SOZINHA quando o processo aparece no acervo.
   *
   * O cadastro pode acontecer por qualquer porta — a tela de processos, a
   * importação em lote, o cadastro manual de sempre. Amarrar o fechamento a UMA
   * delas deixaria a sugestão viva depois de resolvida, e uma fila que pede o
   * que já foi feito é pior que fila nenhuma: ensina a ignorá-la.
   *
   * Por isso a reconciliação é feita na LEITURA, contra o estado real do
   * acervo. É idempotente e não depende de ninguém lembrar de chamá-la.
   */
  private async reconciliar(): Promise<void> {
    const pendentes = await this.prisma.sugestaoProcesso.findMany({
      where: { status: StatusSugestaoProcesso.PENDENTE },
      select: { id: true, numeroCNJ: true },
    });
    if (!pendentes.length) return;

    const cadastrados = await this.prisma.processo.findMany({
      where: { numeroCNJ: { in: pendentes.map((s) => s.numeroCNJ) } },
      select: { id: true, numeroCNJ: true },
    });
    if (!cadastrados.length) return;

    const porNpu = new Map(cadastrados.map((p) => [p.numeroCNJ!, p.id]));
    for (const s of pendentes) {
      const processoId = porNpu.get(s.numeroCNJ);
      if (!processoId) continue;
      await this.prisma.sugestaoProcesso.update({
        where: { id: s.id },
        data: {
          status: StatusSugestaoProcesso.CADASTRADO,
          processoId,
          decididoEm: new Date(),
        },
      });
      // A tarefa "cadastre esta ação" perdeu o objeto — ver o util.
      await fecharTarefaDeCadastro(this.prisma, s.id, 'CADASTRADO');
    }
  }

  /**
   * A fila aberta, da mais recente para a mais antiga.
   *
   * `TERCEIRO` entra junto: o tribunal às vezes não classifica o polo, e
   * esconder a ação por causa disso seria perder justamente o caso em que a
   * informação está incompleta — que é quando alguém precisa olhar.
   */
  /**
   * O ANO DE DISTRIBUIÇÃO, lido do próprio número.
   *
   * O NPU é `NNNNNNN-DD.AAAA.J.TR.OOOO`: sem pontuação, o ano ocupa as posições
   * 10 a 13. É informação que sempre esteve na tela e que ninguém lê — vinte
   * dígitos seguidos não se leem, se conferem.
   */
  private anoDoNpu(numeroCNJ: string): number | null {
    const ano = Number(numeroCNJ.slice(9, 13));
    return Number.isFinite(ano) && ano > 1990 ? ano : null;
  }

  /**
   * OS NOSSOS ADVOGADOS CITADOS NO ATO.
   *
   * A publicação do DJEN traz `advogados` com número e UF da OAB — e a varredura
   * ACHOU essa ação justamente porque uma dessas OABs é nossa. Guardávamos o
   * dado e não o usávamos: os processos cadastrados a partir da fila nasciam com
   * "⚠ Sem advogado", pedindo que alguém escolhesse o que o próprio tribunal
   * tinha acabado de dizer.
   *
   * Medido em 07/09/2026: **30 das 30** ações da fila têm advogado nosso
   * identificável. Não é palpite — é a chave que trouxe a ação até aqui.
   *
   * Pela OAB, nunca pelo nome: o tribunal escreve "ICARO SOL ALMONDES SANTOS" e
   * o cadastro tem "Ícaro Sol Almondes Santos".
   */
  private async advogadosNossosPorSugestao(
    sugestoes: { id: string; advogados: unknown }[],
  ): Promise<Map<string, { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null }[]>> {
    const nossos = await this.prisma.user.findMany({
      where: { ativo: true, oab: { not: null }, oabUf: { not: null } },
      /*
        `avatarKey` JUNTO COM `avatarUrl`, e não só a URL.

        A foto enviada pelo próprio perfil mora no STORAGE: o banco guarda a
        chave, e `avatarUrl` fica nulo. Quem resolve uma na outra é o
        `AvataresInterceptor`, global — mas ele só mexe em objeto que CARREGA a
        chave. Pedindo só a URL, a resposta vem nula e a tela cai nas iniciais.

        Medido em 07/09/2026: os OITO advogados têm `avatarKey` e NENHUM tem
        `avatarUrl`. Eu tinha escrito esta consulta pedindo só a URL, e por isso
        a fila mostrava "T CH" no lugar da cara das pessoas. O aviso estava
        escrito no próprio interceptor: "o que isso exige de quem escreve uma
        consulta nova é selecionar `avatarKey`".
      */
      select: {
        id: true, nome: true, nomeExibicao: true,
        avatarUrl: true, avatarKey: true,
        oab: true, oabUf: true,
      },
    });
    const chave = (numero: unknown, uf: unknown) =>
      `${String(uf ?? '').trim().toUpperCase()}-${String(numero ?? '').replace(/\D/g, '')}`;
    const porOab = new Map(nossos.map((a) => [chave(a.oab, a.oabUf), a]));

    const saida = new Map<string, typeof nossos>();
    for (const s of sugestoes) {
      const lista = Array.isArray(s.advogados)
        ? (s.advogados as { numeroOab?: unknown; ufOab?: unknown }[])
        : [];
      const achados = new Map<string, (typeof nossos)[number]>();
      for (const a of lista) {
        const nosso = porOab.get(chave(a?.numeroOab, a?.ufOab));
        // Mesmo advogado citado duas vezes no ato não vira dois.
        if (nosso) achados.set(nosso.id, nosso);
      }
      saida.set(s.id, [...achados.values()]);
    }
    return saida as never;
  }

  async listar() {
    await this.reconciliar();
    const pendentes = await this.prisma.sugestaoProcesso.findMany({
      where: { status: StatusSugestaoProcesso.PENDENTE },
      select: {
        id: true,
        numeroCNJ: true,
        siglaTribunal: true,
        nomeOrgao: true,
        nomeClasse: true,
        nossoPolo: true,
        partes: true,
        advogados: true,
        primeiraEm: true,
        ultimaEm: true,
        publicacoes: true,
      },
    });

    /*
      A MAIS RECENTEMENTE DISTRIBUÍDA PRIMEIRO — e não a de publicação mais nova.

      A primeira colheita trouxe 32 ações e **só 4 são de 2026**: o resto vai de
      2014 a 2025, seis delas de 2015. Ordenar por publicação misturava a ação
      recém-distribuída — onde há prazo correndo e ninguém olhando — com o passivo
      de cadastro de dez anos atrás, que é importante e não é urgente.

      ORDENAR PELO NPU NÃO SERVE, e o engano é fácil: o número começa pelo
      SEQUENCIAL, não pelo ano. `0009999...2015` viria antes de `0000001...2026`.
      Por isso a ordenação é feita aqui, sobre o ano extraído — são dezenas de
      linhas, e o banco não tem coluna de ano para indexar.
    */
    const advogados = await this.advogadosNossosPorSugestao(pendentes);

    return pendentes
      .map((s) => ({
        ...s,
        anoDistribuicao: this.anoDoNpu(s.numeroCNJ),
        /** Os NOSSOS citados no ato — o que o cadastro pode já vir preenchido. */
        advogadosNossos: advogados.get(s.id) ?? [],
      }))
      .sort((a, b) => {
        const anoA = a.anoDistribuicao ?? 0;
        const anoB = b.anoDistribuicao ?? 0;
        if (anoA !== anoB) return anoB - anoA;
        // Dentro do mesmo ano, a que publicou por último — sinal de que anda.
        return b.ultimaEm.getTime() - a.ultimaEm.getTime();
      })
      .slice(0, 50);
  }

  /** Quantas esperam decisão — o número do selo, sem carregar a lista. */
  async contar(): Promise<number> {
    await this.reconciliar();
    return this.prisma.sugestaoProcesso.count({
      where: { status: StatusSugestaoProcesso.PENDENTE },
    });
  }

  /**
   * CADASTRAR VÁRIAS DE UMA VEZ — com o que o Diário já disse.
   *
   * A colheita trouxe dezenas. Cadastrar uma a uma é abrir o diálogo, conferir,
   * confirmar e fechar — vezes trinta. E o que o diálogo pede que a pessoa
   * confirme, nessas, é exatamente o que a fila já mostrou na linha.
   *
   * O QUE ENTRA: o número, o tribunal e as PARTES como o tribunal as escreveu.
   * O que NÃO entra é o que exige julgamento — filiado vinculado, advogado
   * responsável, etiqueta. Esses ficam para depois, e o sistema JÁ TEM fila para
   * cada um: "Sem filiado vinculado" e "Sem réu cadastrado" na própria tela de
   * Processos. Inventar um assistente de conclusão aqui seria construir uma
   * terceira fila para o trabalho que as duas existentes já cobram.
   *
   * AS PARTES ENTRAM COMO NOME, e não como vínculo. Medido em 07/09/2026: das 78
   * partes não-sindicato encontradas, **76 não existem no cadastro** — não há o
   * que vincular. E onde existe, existe em quatro variantes (HAPVIDA), então
   * escolher uma seria cara ou coroa que agrupa processos sob a empresa errada.
   * Nome agora, vínculo quando gente olhar.
   *
   * UMA POR VEZ, e não em transação única: cada importação consulta o CNJ, e um
   * NPU que o índice não conhece não pode derrubar as outras vinte e nove. O
   * resultado volta linha a linha, dizendo o que entrou e o que não.
   */
  async importarEmLote(
    ids: string[],
    importarUma: (dto: ImportarEmLoteItem) => Promise<{ id: string }>,
    /** Quem clicou. Vai para o `concluidoPor` da tarefa de cadastro. */
    usuarioId?: string | null,
  ) {
    const sugestoes = await this.prisma.sugestaoProcesso.findMany({
      where: { id: { in: ids }, status: StatusSugestaoProcesso.PENDENTE },
      select: {
        id: true, numeroCNJ: true, siglaTribunal: true, nossoPolo: true,
        partes: true, advogados: true,
      },
    });

    /*
      O ADVOGADO VEM JUNTO, e não é palpite: a ação chegou até aqui PORQUE a OAB
      dele estava no ato. Sem isto, cada processo cadastrado em lote nascia com
      "⚠ Sem advogado" — trinta fichas pedindo que alguém escolhesse o que o
      tribunal já tinha dito. Medido: 30 das 30 têm advogado nosso identificável.
    */
    const advogadosPorSugestao = await this.advogadosNossosPorSugestao(sugestoes);

    const sigla = (
      await this.prisma.parteExterna.findFirst({
        where: { institucional: true },
        select: { nomeFantasia: true },
      })
    )?.nomeFantasia;

    /*
      Índice das organizações já cadastradas, montado UMA vez.

      São dezenas de sugestões e 75 organizações; consultar por nome dentro do
      laço seria uma ida ao banco por réu. O `nomeFantasia` também entra: o
      Diário costuma escrever a sigla ("ITACOR"), e o cadastro guarda a razão
      social por extenso.
    */
    const orgsCadastradas = await this.prisma.parteExterna.findMany({
      where: { institucional: false },
      select: { id: true, nome: true, nomeFantasia: true },
    });
    /*
      CHAVE AMBÍGUA NÃO VINCULA — e esta trava é o que separa isto de um chute.

      O teste que existia aqui proibia vincular, e a razão era boa: a HAPVIDA
      está no cadastro em QUATRO variantes, e escolher uma seria cara ou coroa
      que agrupa processos sob a empresa errada.

      O casamento aqui é EXATO sobre o nome normalizado, não aproximado — as
      quatro HAPVIDA dão quatro chaves diferentes ("HAPVIDA",
      "HAPVIDAHOSPITALRIOPOTY"…), e "HAPVIDA ASSISTENCIA MEDICA LTDA" que o
      Diário escreve não casa com nenhuma. Conferido nas 74 organizações da
      produção: ZERO chaves colidem hoje.

      Mas "hoje" não é garantia. Se duas organizações passarem a normalizar
      igual, a chave é DESCARTADA e a parte volta a entrar como nome — o
      comportamento antigo, que é o lado seguro de errar.
    */
    const orgsPorNome = new Map<string, string>();
    const ambiguas = new Set<string>();
    for (const o of orgsCadastradas) {
      for (const chave of [o.nome, o.nomeFantasia].filter(Boolean).map((x) => comparavelNome(x!))) {
        if (!chave) continue;
        if (orgsPorNome.has(chave) && orgsPorNome.get(chave) !== o.id) ambiguas.add(chave);
        orgsPorNome.set(chave, o.id);
      }
    }
    for (const chave of ambiguas) orgsPorNome.delete(chave);

    const resultados: { numeroCNJ: string; ok: boolean; motivo?: string }[] = [];

    for (const s of sugestoes) {
      try {
        const partes = Array.isArray(s.partes) ? (s.partes as { nome?: string; polo?: string }[]) : [];
        const cru = (polo: 'A' | 'P') =>
          partes
            .filter((x) => (x?.polo ?? '').trim().toUpperCase() === polo)
            .map((x) => (x?.nome ?? '').trim())
            .filter(Boolean)
            .filter((n, i, todos) => todos.indexOf(n) === i);

        /*
          RECURSO NÃO ENTRA NO LOTE — sai da fila com o motivo escrito.

          Em recurso os dois lados recorrem, e o tribunal lista a mesma parte
          como recorrente E recorrida. A sugestão acumula as partes de TODAS as
          publicações do processo (24 no 0001023-67.2025.5.22.0001), então a
          mesma empresa acaba com polo `A` numas e `P` noutras.

          Sem trava nenhuma, o lote gravava um processo em que a EBSERH processa
          a EBSERH. Só descartar a parte ambígua também não serve: medido nas 30
          da fila, o único caso ficaria com autor e NENHUM réu — um processo pela
          metade, criado em silêncio, que ninguém revisa porque parece pronto.

          E não dá para adivinhar o lado: o polo de um recurso é a posição
          RECURSAL, não a da ação original. Chutar seria palpite com cara de
          fato — a mesma regra que o `AMBOS` da varredura já respeita.

          Então o lote RECUSA e explica. A recusa aparece agrupada por motivo no
          aviso da tela, a sugestão continua PENDENTE, e o cadastro pela tela
          pergunta o lado de cada parte com um clique. Um caso em trinta.
        */
        const chaveNome = (n: string) =>
          n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
        const noPassivo = new Set(cru('P').map(chaveNome));
        const ambiguos = cru('A').filter((n) => noPassivo.has(chaveNome(n)));
        if (ambiguos.length) {
          resultados.push({
            numeroCNJ: s.numeroCNJ,
            ok: false,
            motivo:
              `é recurso e o Diário lista ${ambiguos.length} parte(s) nos dois polos; ` +
              'cadastre pela tela para escolher o lado de cada uma',
          });
          continue;
        }
        const nomes = (polo: 'A' | 'P') => cru(polo);

        const ehNos = (nome: string) => nossoPoloNoAto([{ nome, polo: 'A' }], sigla) !== null;

        const nossosAdvogados = advogadosPorSugestao.get(s.id) ?? [];

        const processo = await importarUma({
          numeroCNJ: s.numeroCNJ,
          tribunal: s.siglaTribunal ?? undefined,
          /*
            O PRIMEIRO responde; os demais entram como equipe. Quem é o
            "principal" entre dois citados no mesmo ato o tribunal não diz — a
            ordem do ato é o único critério disponível, e trocar depois é um
            clique na ficha.
          */
          advogadoId: nossosAdvogados[0]?.id,
          advogadosIds: nossosAdvogados.length > 1 ? nossosAdvogados.map((a) => a.id) : undefined,
          poloAtivo: {
            // O sindicato tem tipo próprio; o resto entra como nome dos autos.
            tipo: nomes('A').some(ehNos) ? 'INSTITUCIONAL' : 'OUTRA',
            partes: nomes('A').map((nome) =>
              ehNos(nome) ? { tipo: 'INSTITUCIONAL' as const } : { tipo: 'AVULSA' as const, nome },
            ),
          },
          /*
            RÉU QUE JÁ TEM CADASTRO ENTRA PELO CADASTRO, não como nome solto.

            O lote mandava só `{ nome }`, e `semearNaImportacao` cria parte
            avulsa quando não recebe `parteExternaId`. Resultado: a mesma
            empresa vira uma organização cadastrada E várias partes soltas com
            o mesmo nome — e aí "todos os processos contra a mesma empresa
            juntos" deixa de ser verdade, que é a razão de a tabela de
            organizações existir.

            O ITACOR do 0001000-26.2022.5.22.0002 é exatamente isso: a
            organização existe e está ligada em outros dois processos, e o
            terceiro entrou solto. Medido nas 30 da fila: 2 das 31 partes
            adversas já têm cadastro — inclusive PRONTOCARE, que o comentário
            de `semearNaImportacao` cita como o caso de duplicata que ele
            aprendeu a evitar do outro lado.

            O casamento é pelo NOME NORMALIZADO (sem acento, sem pontuação), a
            mesma régua de `comparavel` no serviço de partes — o Diário escreve
            em caixa alta e sem acento, o cadastro não.
          */
          partesContrarias: nomes('P')
            .filter((nome) => !ehNos(nome))
            .map((nome) => {
              const org = orgsPorNome.get(comparavelNome(nome));
              return org ? { nome, parteExternaId: org } : { nome };
            }),
        });

        await this.prisma.sugestaoProcesso.update({
          where: { id: s.id },
          data: {
            status: StatusSugestaoProcesso.CADASTRADO,
            processoId: processo.id,
            decididoEm: new Date(),
          },
        });
        await fecharTarefaDeCadastro(this.prisma, s.id, 'CADASTRADO', usuarioId);
        resultados.push({ numeroCNJ: s.numeroCNJ, ok: true });
      } catch (err) {
        resultados.push({
          numeroCNJ: s.numeroCNJ,
          ok: false,
          motivo: (err as Error).message,
        });
      }
    }

    return {
      cadastrados: resultados.filter((r) => r.ok).length,
      falhas: resultados.filter((r) => !r.ok).length,
      resultados,
    };
  }

  /**
   * "NÃO É PARA ACOMPANHAR" — e o porquê fica registrado.
   *
   * O motivo não é burocracia: a mesma ação volta a aparecer no Diário por
   * meses, e sem o registro a próxima pessoa refaz a mesma investigação. É
   * também o que permite auditar uma decisão que, no limite, deixa um processo
   * do sindicato fora do acompanhamento.
   */
  async ignorar(id: string, usuarioId: string, motivo?: string) {
    const sugestao = await this.prisma.sugestaoProcesso.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!sugestao) throw new NotFoundException('Sugestão não encontrada.');
    if (sugestao.status !== StatusSugestaoProcesso.PENDENTE) {
      throw new BadRequestException('Esta sugestão já foi decidida.');
    }

    const ignorada = await this.prisma.sugestaoProcesso.update({
      where: { id },
      data: {
        status: StatusSugestaoProcesso.IGNORADO,
        decididoPor: usuarioId,
        decididoEm: new Date(),
        motivoDescarte: motivo?.trim() || null,
      },
      select: { id: true, status: true },
    });
    // Quem descartou é quem clicou — o id já está aqui, e ficava fora.
    await fecharTarefaDeCadastro(this.prisma, id, 'DESCARTADO', usuarioId);
    return ignorada;
  }

  /**
   * DESFAZER O IGNORAR. Quem errou tem de poder voltar atrás sem mexer no
   * banco — e sem isso a única saída seria cadastrar um processo que ninguém
   * quer, só para tirar a linha da frente.
   */
  async reabrir(id: string) {
    const sugestao = await this.prisma.sugestaoProcesso.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!sugestao) throw new NotFoundException('Sugestão não encontrada.');
    if (sugestao.status === StatusSugestaoProcesso.CADASTRADO) {
      throw new BadRequestException('Esta ação já virou processo no acervo.');
    }

    return this.prisma.sugestaoProcesso.update({
      where: { id },
      data: {
        status: StatusSugestaoProcesso.PENDENTE,
        decididoPor: null,
        decididoEm: null,
        motivoDescarte: null,
        /*
          SOLTA A TAREFA ANTIGA — ela foi CANCELADA quando a ação saiu da fila.
          Sem zerar o vínculo, a sugestão volta para PENDENTE apontando para uma
          tarefa morta, e `agendarCadastroDasRecentes` (que só olha
          `compromissoId: null`) nunca criaria a substituta. Reabrir daria uma
          fila sem cobrança nenhuma — silenciosamente.
        */
        compromissoId: null,
      },
      select: { id: true, status: true },
    });
  }
}

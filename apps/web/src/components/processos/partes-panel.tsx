'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, Building2, ExternalLink, Landmark, Loader2, Plus, Scale,
  Star, Swords, Trash2, User as UserIcon, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { SeletorAdvogados, type ValorSeletorAdvogados } from './seletor-advogados';
import { classesCor } from '@/lib/paleta-cores';
import { AdicionarParteForm } from './adicionar-parte-form';
import {
  adicionarParte,
  advogadosDoAtoSemLado, partesDoAtoEmDuvida,
  atualizarParte, definirAdvogadosDoProcesso, formatDocumento, removerParte,
  POLO_COR, POLO_DESCRICAO, POLO_LABEL, TIPO_PARTE_LABEL,
  type AdvogadoCitadoNoAto, type AdvogadoDaParte, type AdvogadoDoProcesso,
  type ParteDoProcesso, type ParteEmDuvida, type PoloProcesso, type PolosProcesso,
} from '@/lib/partes';

const ORDEM_POLOS: PoloProcesso[] = ['ATIVO', 'PASSIVO', 'TERCEIRO'];

/**
 * Aba "Partes" do processo: quem entrou com a ação, contra quem, e a equipe da
 * casa que atua no caso.
 *
 * Existe porque o DataJud NÃO devolve partes — a API Pública do CNJ expõe só
 * metadados processuais (verificado em TJPI, TRT22, TJSP e TRF1). Então esta
 * tela não "mostra o que o tribunal mandou": ela é onde o dado nasce.
 */
export function PartesPanel({
  processoId,
  polos,
  advogados,
  podeEditar,
  ehAdmin,
  onChanged,
}: {
  processoId: string;
  polos: PolosProcesso;
  advogados: AdvogadoDoProcesso[];
  podeEditar: boolean;
  ehAdmin: boolean;
  onChanged: () => void;
}) {
  const [adicionandoEm, setAdicionandoEm] = useState<PoloProcesso | null>(null);
  const [parteParaExcluir, setParteParaExcluir] = useState<ParteDoProcesso | null>(null);
  const [editandoEquipe, setEditandoEquipe] = useState(false);

  const porPolo: Record<PoloProcesso, ParteDoProcesso[]> = {
    ATIVO: polos.ativo,
    PASSIVO: polos.passivo,
    TERCEIRO: polos.terceiros,
  };

  const remover = useMutation({
    mutationFn: (id: string) => removerParte(id),
    onSuccess: () => { toast.success('Parte removida.'); setParteParaExcluir(null); onChanged(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível remover a parte.'),
  });

  /*
    A LISTA DE ADVOGADOS DA PARTE vai inteira, como todo PATCH de parte. Os
    campos voltam como vieram (`origem`, `numeroOab`), senão o que o Diário
    trouxe viraria "digitado por gente" no primeiro salvamento.
  */
  const qc = useQueryClient();
  const salvarAdvogadosDaParte = useMutation({
    mutationFn: ({ id, advogados }: { id: string; advogados: AdvogadoDaParte[] }) =>
      atualizarParte(id, { advogados }),
    onSuccess: () => {
      toast.success('Advogados da parte atualizados.');
      // Quem acabou de ganhar dono sai da lista de "sem lado" na hora.
      qc.invalidateQueries({ queryKey: ['processo', processoId, 'advogados-do-ato'] });
      onChanged();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível atualizar os advogados.'),
  });

  /*
    INCLUIR A PARTE QUE O DIÁRIO NOMEIA E O ROBÔ NÃO POSICIONOU.

    Entra como MANUAL porque quem escolheu o lado foi gente — a marca é o que
    permite a tela dizer depois "isto alguém conferiu" em vez de tratar como
    palpite do robô.
  */
  const incluirParteDoAto = useMutation({
    mutationFn: ({ nome, polo }: { nome: string; polo: PoloProcesso }) =>
      adicionarParte(processoId, { polo, nome }),
    onSuccess: () => {
      toast.success('Parte incluída.');
      qc.invalidateQueries({ queryKey: ['processo', processoId, 'partes-do-ato'] });
      onChanged();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível incluir a parte.'),
  });

  const promover = useMutation({
    mutationFn: (id: string) => atualizarParte(id, { principal: true }),
    onSuccess: () => { toast.success('Parte principal atualizada.'); onChanged(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível atualizar.'),
  });

  const semReu = polos.passivo.length === 0;

  return (
    <div className="space-y-5">
      {/* Confronto em destaque — a resposta a "quem processou quem" */}
      <section className="rounded-xl border bg-card p-4">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Swords className="h-4 w-4 text-brand-800 dark:text-brand-400" /> Confronto
        </h4>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <LadoConfronto
            parte={polos.confronto.autor}
            outros={polos.confronto.outrosAtivo}
            polo="ATIVO"
          />
          <span className="self-center px-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            versus
          </span>
          <LadoConfronto
            parte={polos.confronto.reu}
            outros={polos.confronto.outrosPassivo}
            polo="PASSIVO"
          />
        </div>
        {semReu && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Sem parte contrária cadastrada.</strong> A API Pública do DataJud não divulga as
              partes do processo — este dado precisa ser informado pela equipe.
            </span>
          </p>
        )}
      </section>

      {/* Polos */}
      {ORDEM_POLOS.map((polo) => {
        const lista = porPolo[polo];
        // Terceiros só aparecem quando existem ou quando se vai adicionar um —
        // a maioria dos processos não tem, e a seção vazia só polui.
        if (polo === 'TERCEIRO' && lista.length === 0 && adicionandoEm !== 'TERCEIRO') {
          return podeEditar ? (
            <button
              key={polo}
              type="button"
              onClick={() => setAdicionandoEm('TERCEIRO')}
              className="w-full rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground transition hover:border-brand-400 hover:text-foreground"
            >
              <Plus className="mr-1 inline h-3.5 w-3.5" /> Adicionar terceiro interessado
            </button>
          ) : null;
        }

        const cor = classesCor(POLO_COR[polo]);
        return (
          <section key={polo}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <span className={cn('h-2.5 w-2.5 rounded-full', cor.ponto)} />
                {POLO_LABEL[polo]}
                <span className="text-xs font-normal text-muted-foreground">
                  — {POLO_DESCRICAO[polo]}
                </span>
              </h4>
              {podeEditar && adicionandoEm !== polo && (
                <Button size="sm" variant="outline" onClick={() => setAdicionandoEm(polo)}>
                  <Plus className="h-4 w-4" /> Adicionar
                </Button>
              )}
            </div>

            {adicionandoEm === polo && (
              <div className="mb-2">
                <AdicionarParteForm
                  processoId={processoId}
                  polo={polo}
                  onAdicionada={() => { setAdicionandoEm(null); onChanged(); }}
                  onCancelar={() => setAdicionandoEm(null)}
                />
              </div>
            )}

            {lista.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                Nenhuma parte cadastrada neste polo.
              </p>
            ) : (
              <ul className="space-y-2">
                {lista.map((parte) => (
                  <CardParte
                    key={parte.id}
                    parte={parte}
                    podeEditar={podeEditar}
                    ehAdmin={ehAdmin}
                    promovendo={promover.isPending}
                    onPromover={() => promover.mutate(parte.id)}
                    onExcluir={() => setParteParaExcluir(parte)}
                    onAdvogados={(advogados) =>
                      salvarAdvogadosDaParte.mutate({ id: parte.id, advogados })
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <PartesEmDuvida
        processoId={processoId}
        podeEditar={podeEditar}
        onIncluir={(parte, polo) => incluirParteDoAto.mutate({ nome: parte.nome, polo })}
        salvando={incluirParteDoAto.isPending}
      />

      <AdvogadosSemLado
        processoId={processoId}
        partes={[...polos.ativo, ...polos.passivo, ...polos.terceiros]}
        podeEditar={podeEditar}
        onAtribuir={(parte, advogado) =>
          salvarAdvogadosDaParte.mutate({
            id: parte.id,
            advogados: [
              ...(parte.advogados ?? []),
              {
                nome: advogado.nome,
                oab: [advogado.ufOab, advogado.numeroOab].filter(Boolean).join(' ') || null,
                numeroOab: advogado.numeroOab,
                ufOab: advogado.ufOab,
                // Quem apontou foi gente: a marca tem de dizer isso.
                origem: 'MANUAL',
              },
            ],
          })
        }
      />

      {/* Equipe da casa */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            Advogados do sindicato
            <span className="text-xs font-normal text-muted-foreground">— quem atua no caso</span>
          </h4>
          {podeEditar && !editandoEquipe && (
            <Button size="sm" variant="outline" onClick={() => setEditandoEquipe(true)}>
              <Users className="h-4 w-4" /> Gerenciar equipe
            </Button>
          )}
        </div>

        {editandoEquipe ? (
          <EquipeEditor
            processoId={processoId}
            atuais={advogados}
            onSalvo={() => { setEditandoEquipe(false); onChanged(); }}
            onCancelar={() => setEditandoEquipe(false)}
          />
        ) : advogados.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            Nenhum advogado vinculado a este processo.
          </p>
        ) : (
          <ul className="space-y-2">
            {advogados.map(({ advogado, principal }) => (
              <li key={advogado.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                {advogado.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={advogado.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-400 text-sm font-bold text-brand-900">
                    {(advogado.nomeExibicao || advogado.nome).charAt(0)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {advogado.nomeExibicao || advogado.nome}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {advogado.oab ? `OAB ${advogado.oab}${advogado.oabUf ? `/${advogado.oabUf}` : ''}` : 'sem OAB cadastrada'}
                  </p>
                </div>
                {principal && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-400">
                    <Star className="h-3 w-3" /> Responsável
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!parteParaExcluir}
        variant="destructive"
        title="Remover parte do processo"
        icon={<Trash2 className="h-6 w-6" />}
        description={
          <>
            Remover <strong>{parteParaExcluir?.nome}</strong> do{' '}
            {parteParaExcluir ? POLO_LABEL[parteParaExcluir.polo].toLowerCase() : ''} deste processo?
            {parteParaExcluir?.parteExternaId && (
              <> O <strong>cadastro</strong> da parte é preservado — sai apenas deste processo.</>
            )}
          </>
        }
        confirmLabel="Remover parte"
        loading={remover.isPending}
        onConfirm={() => parteParaExcluir && remover.mutate(parteParaExcluir.id)}
        onClose={() => setParteParaExcluir(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Um lado do confronto (autor × réu). */
function LadoConfronto({
  parte, outros, polo,
}: {
  parte: ParteDoProcesso | null;
  outros: number;
  polo: PoloProcesso;
}) {
  const cor = classesCor(POLO_COR[polo]);
  return (
    <div className={cn('min-w-0 flex-1 rounded-lg border border-l-4 bg-card p-3', cor.borda)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {POLO_LABEL[polo]}
      </p>
      {parte ? (
        <>
          <p className="truncate text-sm font-bold" title={parte.nome}>{parte.nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {parte.papel ?? '—'}
            {outros > 0 && ` · +${outros} ${outros === 1 ? 'outra parte' : 'outras partes'}`}
          </p>
        </>
      ) : (
        <p className="text-sm italic text-muted-foreground">não informado</p>
      )}
    </div>
  );
}

/** Card de uma parte, com o vínculo (filiado / cadastro / texto livre) explícito. */
function CardParte({
  parte, podeEditar, ehAdmin, promovendo, onPromover, onExcluir, onAdvogados,
}: {
  parte: ParteDoProcesso;
  podeEditar: boolean;
  ehAdmin: boolean;
  promovendo: boolean;
  onPromover: () => void;
  onExcluir: () => void;
  onAdvogados: (lista: AdvogadoDaParte[]) => void;
}) {
  const Icone =
    parte.filiado ? UserIcon
    : parte.parteExterna?.tipo === 'ORGAO_PUBLICO' ? Landmark
    : parte.parteExterna?.tipo === 'FISICA' ? UserIcon
    : parte.parteExterna ? Building2
    : UserIcon;

  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icone className="h-4 w-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-medium">{parte.nome}</p>
            {parte.principal && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-400">
                <Star className="h-3 w-3" /> Principal
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {parte.papel ?? '—'}
            {parte.documento ? ` · ${formatDocumento(parte.documento)}` : ''}
          </p>

          {/* De onde vem a identidade desta parte */}
          {parte.filiado ? (
            <Link
              href={`/filiados/${parte.filiado.id}`}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-800 hover:underline dark:text-brand-400"
            >
              <UserIcon className="h-3 w-3" /> Filiado · matrícula {parte.filiado.matricula}
              <ExternalLink className="h-3 w-3" />
            </Link>
          ) : parte.parteExterna ? (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Building2 className="h-3 w-3" /> {TIPO_PARTE_LABEL[parte.parteExterna.tipo]} · cadastrada
            </span>
          ) : (
            <span
              className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              title="Parte anotada só neste processo — não entra nos relatórios por parte."
            >
              Apenas neste processo
            </span>
          )}

          <AdvogadosDaParte
            lista={parte.advogados ?? []}
            podeEditar={podeEditar}
            onRemover={(i) => onAdvogados((parte.advogados ?? []).filter((_, k) => k !== i))}
          />
          {parte.observacao && (
            <p className="mt-1 text-[11px] italic text-muted-foreground">{parte.observacao}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {podeEditar && !parte.principal && (
            <button
              type="button"
              onClick={onPromover}
              disabled={promovendo}
              title="Tornar a parte principal deste polo"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Star className="h-3.5 w-3.5" />
            </button>
          )}
          {ehAdmin && (
            <button
              type="button"
              onClick={onExcluir}
              title="Remover parte do processo"
              className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Editor da equipe: marca quem atua e quem é o responsável. Envia a lista
 * COMPLETA numa chamada — o backend recalcula o responsável de uma vez, em vez
 * de sofrer uma sequência de adiciona/remove que deixaria estados intermediários.
 */
function EquipeEditor({
  processoId, atuais, onSalvo, onCancelar,
}: {
  processoId: string;
  atuais: AdvogadoDoProcesso[];
  onSalvo: () => void;
  onCancelar: () => void;
}) {
  /**
   * Mesma escolha, mesmo componente da importação. Antes havia duas telas para
   * "quem atua neste processo" — uma aqui, outra no modal de importar — e elas
   * já divergiam: só esta tinha estrela de responsável.
   */
  const [selecao, setSelecao] = useState<ValorSeletorAdvogados>({
    ids: atuais.map((a) => a.advogado.id),
    principal: atuais.find((a) => a.principal)?.advogado.id ?? atuais[0]?.advogado.id ?? '',
  });

  const salvar = useMutation({
    mutationFn: () =>
      definirAdvogadosDoProcesso(
        processoId,
        selecao.ids,
        selecao.ids.includes(selecao.principal) ? selecao.principal : undefined,
      ),
    onSuccess: () => { toast.success('Equipe do processo atualizada.'); onSalvo(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível salvar a equipe.'),
  });

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">
        Marque quem atua no processo. A estrela define o{' '}
        <strong className="text-foreground">responsável</strong> — é ele que aparece na lista e em
        "Meus processos".
      </p>
      <SeletorAdvogados
        valor={selecao}
        onChange={setSelecao}
        vazioLabel="Nenhum advogado no processo"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancelar} disabled={salvar.isPending}>
          Cancelar
        </Button>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar equipe
        </Button>
      </div>
    </div>
  );
}

/**
 * OS ADVOGADOS DA OUTRA PARTE — quem senta do outro lado da mesa.
 *
 * Isto era uma linha de texto que nunca teve conteúdo: das 345 partes da
 * produção, ZERO tinham advogado anotado, porque só dava para digitar um a um e
 * ninguém digita. A varredura do Diário agora preenche — e por isso cada nome
 * carrega a marca de ONDE veio.
 *
 * A marca não é enfeite: o CNJ manda a lista de advogados do ato sem dizer de
 * quem cada um é. O sistema atribui quando existe uma única parte no polo
 * contrário; quem lê precisa saber que aquilo é dedução, e poder desfazer num
 * toque.
 */
function AdvogadosDaParte({
  lista,
  podeEditar,
  onRemover,
}: {
  lista: AdvogadoDaParte[];
  podeEditar: boolean;
  onRemover: (indice: number) => void;
}) {
  if (!lista.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-medium text-muted-foreground">
        Advogados desta parte <span className="font-normal">({lista.length})</span>
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {lista.map((a, i) => (
          <li
            key={`${a.numeroOab ?? ''}-${a.nome ?? ''}-${i}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background py-1 pl-2.5 pr-1 text-[11px]"
          >
            <Scale className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{a.nome || 'Sem nome'}</span>
            {a.oab && <span className="shrink-0 text-muted-foreground">{a.oab}</span>}
            {a.origem === 'DJEN' && (
              <span
                title="Veio do Diário: o ato citou este advogado e ele foi atribuído a esta parte porque ela é a única do polo contrário. Confira — e corrija se não for."
                className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                do Diário
              </span>
            )}
            {podeEditar && (
              <button
                type="button"
                onClick={() => onRemover(i)}
                aria-label={`Tirar ${a.nome ?? 'advogado'} desta parte`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-red-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * O QUE O DIÁRIO CITA E NÃO DIZ DE QUEM É.
 *
 * Com duas ou mais partes no polo contrário, atribuir o advogado seria escolher
 * no chute — e um nome no réu errado é pior que nome nenhum numa audiência.
 * Então o sistema mostra o que sobrou e deixa alguém apontar. Um toque por
 * advogado, e ele para de perguntar.
 */
function AdvogadosSemLado({
  processoId,
  partes,
  podeEditar,
  onAtribuir,
}: {
  processoId: string;
  partes: ParteDoProcesso[];
  podeEditar: boolean;
  onAtribuir: (parte: ParteDoProcesso, advogado: AdvogadoCitadoNoAto) => void;
}) {
  const { data: semLado = [] } = useQuery({
    queryKey: ['processo', processoId, 'advogados-do-ato'],
    queryFn: () => advogadosDoAtoSemLado(processoId),
  });

  if (!semLado.length || !partes.length) return null;

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Scale className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        {semLado.length === 1
          ? 'Um advogado do Diário sem parte definida'
          : `${semLado.length} advogados do Diário sem parte definida`}
      </h4>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        O Diário traz a lista de advogados do ato, mas não diz quem cada um representa. Como este
        processo tem mais de uma parte no polo contrário, o sistema não escolheu
        {podeEditar ? ' — aponte você, e ele para de perguntar.' : '. Quem edita o processo pode apontar.'}
      </p>
      <ul className="mt-2 space-y-2">
        {semLado.map((a) => (
          <li key={`${a.ufOab ?? ''}-${a.numeroOab ?? a.nome}`} className="rounded-lg border bg-card p-2.5">
            <p className="text-sm font-medium">{a.nome}</p>
            <p className="text-[11px] text-muted-foreground">
              {[a.ufOab, a.numeroOab].filter(Boolean).join(' ') || 'sem OAB no ato'}
            </p>
            {podeEditar && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Representa:</span>
                {partes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onAtribuir(p, a)}
                    className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border px-3 text-[11px] font-medium transition hover:border-brand-400 hover:bg-muted"
                  >
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', classesCor(POLO_COR[p.polo]).ponto)} />
                    <span className="truncate">{p.nome}</span>
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * O QUE O DIÁRIO NOMEIA E O ROBÔ NÃO POSICIONOU.
 *
 * A varredura da madrugada acrescenta sozinha toda parte cujo lado não deixa
 * dúvida — foram 51 partes em 43 fichas na primeira passagem. Sobram duas
 * situações, e as duas param aqui:
 *
 *  · o tribunal escreve a MESMA parte nos dois polos (é assim que ele publica
 *    recurso: os dois lados recorrem);
 *  · o ato numera os polos do RECURSO e não os da ação — a EBSERH aparece como
 *    "A" porque foi ela quem recorreu, embora na ação seja a ré.
 *
 * Nos dois casos o sistema tem o NOME (que é fato do tribunal) e não tem o
 * LADO. Mostrar o nome e deixar escolher em um toque é honesto; adivinhar
 * colocaria a parte no lado errado da ficha para sempre, e a ficha é o que
 * responde "de quem é este prazo".
 */
function PartesEmDuvida({
  processoId,
  podeEditar,
  onIncluir,
  salvando,
}: {
  processoId: string;
  podeEditar: boolean;
  onIncluir: (parte: ParteEmDuvida, polo: PoloProcesso) => void;
  salvando: boolean;
}) {
  const { data: emDuvida = [] } = useQuery({
    queryKey: ['processo', processoId, 'partes-do-ato'],
    queryFn: () => partesDoAtoEmDuvida(processoId),
  });
  if (!emDuvida.length) return null;

  // Todas as pendências deste processo têm o mesmo motivo: o que separa é o
  // processo, não a parte. Uma explicação em cima vale por todas.
  const motivo = emDuvida[0].porque;

  return (
    <section className="rounded-xl border border-sky-300 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" />
        {emDuvida.length === 1
          ? 'Uma parte do Diário sem lado definido'
          : `${emDuvida.length} partes do Diário sem lado definido`}
      </h4>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        O tribunal nomeia {emDuvida.length === 1 ? 'esta parte' : 'estas partes'} no processo, mas{' '}
        {motivo}.{' '}
        {podeEditar
          ? 'Escolha o lado e ela entra na ficha.'
          : 'Quem edita o processo pode definir o lado.'}
      </p>
      <ul className="mt-2 space-y-2">
        {emDuvida.map((p) => (
          <li key={p.nome} className="rounded-lg border bg-card p-2.5">
            <p className="text-sm font-medium leading-snug">{p.nome}</p>
            {podeEditar && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(['ATIVO', 'PASSIVO'] as const).map((polo) => (
                  <button
                    key={polo}
                    type="button"
                    disabled={salvando}
                    onClick={() => onIncluir(p, polo)}
                    className={cn(
                      'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition',
                      'hover:bg-muted disabled:opacity-50',
                      // A sugestão do ato fica em destaque leve: ajuda quem
                      // conhece o caso e não decide por quem não conhece.
                      p.polo === polo && 'border-sky-400 bg-sky-100/70 dark:bg-sky-900/30',
                    )}
                  >
                    <span className={cn('h-2 w-2 rounded-full', classesCor(POLO_COR[polo]).ponto)} />
                    {POLO_LABEL[polo]}
                    {p.polo === polo && <span className="text-muted-foreground">· o ato diz este</span>}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

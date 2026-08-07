'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, Building2, ExternalLink, Landmark, Loader2, Plus, Scale,
  Star, Swords, Trash2, User as UserIcon, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { SeletorAdvogados, type ValorSeletorAdvogados } from './seletor-advogados';
import { classesCor } from '@/lib/paleta-cores';
import { AdicionarParteForm } from './adicionar-parte-form';
import {
  atualizarParte, definirAdvogadosDoProcesso, formatDocumento, removerParte,
  POLO_COR, POLO_DESCRICAO, POLO_LABEL, TIPO_PARTE_LABEL,
  type AdvogadoDoProcesso, type ParteDoProcesso, type PoloProcesso, type PolosProcesso,
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
          <Swords className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" /> Confronto
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
              className="w-full rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground transition hover:border-senatepi-400 hover:text-foreground"
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
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {/* Equipe da casa */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" />
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
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-senatepi-400 text-sm font-bold text-senatepi-900">
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
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-senatepi-50 px-2 py-0.5 text-[10px] font-semibold text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-400">
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

/** Um lado do confronto ("SENATEPI" × "PRONTOCARE"). */
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
  parte, podeEditar, ehAdmin, promovendo, onPromover, onExcluir,
}: {
  parte: ParteDoProcesso;
  podeEditar: boolean;
  ehAdmin: boolean;
  promovendo: boolean;
  onPromover: () => void;
  onExcluir: () => void;
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
              <span className="inline-flex items-center gap-1 rounded-full bg-senatepi-50 px-2 py-0.5 text-[10px] font-semibold text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-400">
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
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-senatepi-800 hover:underline dark:text-senatepi-400"
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

          {(parte.advogados?.length ?? 0) > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Advogados da parte:{' '}
              {parte.advogados!.map((a) => [a.nome, a.oab].filter(Boolean).join(' — ')).join('; ')}
            </p>
          )}
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

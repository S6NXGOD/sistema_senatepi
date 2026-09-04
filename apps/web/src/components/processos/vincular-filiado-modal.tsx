'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Search, Loader2, UserPlus, UserCheck, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import { atualizarProcesso } from '@/lib/processos';
import { identificarParteComoFiliado, sugestoesDeFiliado, type CandidatoFiliado } from '@/lib/partes';
import { FormularioFiliadoRapido } from '@/components/filiados/formulario-filiado-rapido';
import { V } from '@/lib/vocabulario';

type Modo = 'buscar' | 'criar';

/**
 * Resolve o vínculo do processo com um filiado SEM sair da tela: reconhece o
 * cadastro que já existe, procura outro, ou cria um novo com o mínimo (nome,
 * CPF e nascimento — os obrigatórios da API) e vincula.
 *
 * POR QUE ELE COMEÇA COM SUGESTÃO. Digitar o nome dos autos na busca costuma
 * devolver ZERO: nos autos a pessoa aparece com o nome inteiro e no cadastro
 * com o de uso ("SARA MACHADO MIRANDA LEAL BARBOSA" contra "SARA MACHADO
 * MIRANDA"), ou o contrário ("MARCOS VICTOR" contra "MARCOS VICTOR BARROS
 * SILVA"). Quem procurava concluía que a pessoa não era filiada e desistia — e
 * o processo seguia "sem filiado vinculado" com a filiada cadastrada o tempo
 * todo. A API compara por subconjunto de nome e por CPF, e devolve os
 * candidatos prontos.
 *
 * VINCULAR A PARTE, e não o processo. Com `parteId`, a parte que já está nos
 * autos passa a apontar para o cadastro. Sem ele, o caminho antigo ADICIONA uma
 * parte nova ao polo ativo — e o processo fica com dois autores que são a mesma
 * pessoa.
 */
export function VincularFiliadoModal({
  open, processoId, onClose, onVinculado, nomeSugerido, parteId,
}: {
  open: boolean;
  processoId: string;
  onClose: () => void;
  onVinculado: () => void;
  /** Nome vindo das partes do processo, quando houver — poupa digitação. */
  nomeSugerido?: string | null;
  /** A parte do polo ativo ainda sem cadastro, quando existe. */
  parteId?: string | null;
}) {
  const [modo, setModo] = useState<Modo>('buscar');

  // --- buscar ---
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  // --- criar --- (os campos vivem em `FormularioFiliadoRapido`)
  const [nome, setNome] = useState('');

  useEffect(() => {
    if (!open) return;
    setModo('buscar');
    // A busca exige TODOS os termos: o nome inteiro dos autos devolve zero
    // sempre que o cadastro é mais curto. Dois nomes já restringem o bastante
    // e ainda encontram quem tem sobrenome a mais na ficha.
    setBusca((nomeSugerido ?? '').split(/\s+/).slice(0, 2).join(' '));
    setResultados([]);
    setNome(nomeSugerido ?? '');
  }, [open, nomeSugerido]);

  const { data: sugestoes = [], isLoading: carregandoSugestoes } = useQuery({
    queryKey: ['sugestoes-filiado', parteId],
    queryFn: () => sugestoesDeFiliado(parteId as string),
    enabled: open && !!parteId,
    staleTime: 60_000,
  });

  useEffect(() => {
    const termo = busca.trim();
    if (modo !== 'buscar' || termo.length < 2) { setResultados([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      try { setResultados(await buscarFiliados(termo)); }
      catch { setResultados([]); }
      finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca, modo]);

  const vincular = useMutation({
    mutationFn: async (filiadoId: string): Promise<void> => {
      if (parteId) await identificarParteComoFiliado(parteId, filiadoId);
      else await atualizarProcesso(processoId, { filiadoId });
    },
    onSuccess: () => { toast.success(`${V.Filiado} vinculado ao processo.`); onVinculado(); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível vincular.'),
  });

  async function vincularRecemCriado(filiadoId: string) {
    try {
      if (parteId) await identificarParteComoFiliado(parteId, filiadoId);
      else await atualizarProcesso(processoId, { filiadoId });
      toast.success(`${V.Filiado} cadastrado e vinculado.`);
      onVinculado();
      onClose();
    } catch {
      // O cadastro FOI criado; só o vínculo falhou. Dizer "erro ao cadastrar"
      // faria a pessoa tentar de novo e esbarrar em "CPF já existe".
      toast.error(`${V.Filiado} cadastrado, mas o vínculo com o processo falhou. Procure-o na busca.`);
      setModo('buscar');
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="font-semibold">Vincular {V.filiado}</h3>
            <p className="text-xs text-muted-foreground">O vínculo é opcional — pode ser feito depois.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Alternância entre buscar e cadastrar */}
        <div className="flex gap-1 border-b p-3">
          {([
            { k: 'buscar' as const, label: 'Buscar existente', icon: UserCheck },
            { k: 'criar' as const, label: 'Cadastrar novo', icon: UserPlus },
          ]).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.k}
                type="button"
                onClick={() => setModo(t.k)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
                  modo === t.k ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {modo === 'buscar' ? (
            <>
              {carregandoSugestoes && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procurando no cadastro…
                </p>
              )}

              {sugestoes.length > 0 && (
                <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/20">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-brand-900 dark:text-brand-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    {sugestoes.length === 1 ? 'Parece ser este cadastro' : 'Pode ser um destes cadastros'}
                  </p>
                  <ul className="space-y-1.5">
                    {sugestoes.map((c: CandidatoFiliado) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => vincular.mutate(c.id)}
                          disabled={vincular.isPending}
                          className="w-full rounded-md border bg-card px-3 py-2 text-left transition hover:border-brand-400 disabled:opacity-60"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-sm font-medium">{c.nome}</span>
                            {c.confianca === 'CERTEZA' && (
                              <span className="shrink-0 rounded-full bg-brand-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                                mesmo CPF
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                            {c.cpfMascarado ? `${c.cpfMascarado} · ` : ''}{c.motivo}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {/*
                    A CONFERÊNCIA É DE QUEM LÊ. Nome de brasileiro repete —
                    "ANGELA MARIA" casa com quatro filiadas distintas nesta
                    base. Vincular a pessoa errada junta o processo de uma à
                    ficha de outra, e isso não se desfaz com um Ctrl+Z.
                  */}
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                    Confira o nome antes de vincular. Se nenhum for, procure abaixo.
                  </p>
                </div>
              )}

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  autoFocus
                  placeholder={`Nome ou CPF do ${V.filiado}…`}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              </div>

              {busca.trim().length >= 2 && !buscando && resultados.length === 0 && (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <p className="text-sm text-muted-foreground">Nenhum {V.filiado} encontrado.</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => { setNome(busca); setModo('criar'); }}>
                    <UserPlus className="h-4 w-4" /> Cadastrar "{busca.trim().slice(0, 24)}"
                  </Button>
                </div>
              )}

              {resultados.length > 0 && (
                <ul className="divide-y overflow-hidden rounded-lg border">
                  {resultados.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => vincular.mutate(f.id)}
                        disabled={vincular.isPending}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition hover:bg-muted disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{f.nome}</span>
                          <span className="block text-xs text-muted-foreground">{f.cpfMascarado}</span>
                        </span>
                        {vincular.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-brand-700" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <FormularioFiliadoRapido
              nomeInicial={nome}
              onCriado={(f) => vincularRecemCriado(f.id)}
              onCancelar={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

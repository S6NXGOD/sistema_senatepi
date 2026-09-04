'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Search, Loader2, UserPlus, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import { atualizarProcesso } from '@/lib/processos';
import { identificarParteComoFiliado, sugestoesDeFiliado, type CandidatoFiliado } from '@/lib/partes';
import { CadastroFiliadoModal } from '@/components/filiados/cadastro-filiado-modal';
import { usePodeCadastrarFiliado } from '@/components/filiados/permissao-cadastro';
import { V } from '@/lib/vocabulario';

/**
 * "QUEM É A PARTE DESTE PROCESSO?" — resolvido sem sair da tela.
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
 *
 * CADASTRAR É OUTRO MODAL, por cima deste. Era uma aba com quatro campos, e
 * quatro campos não fazem um cadastro: o do sindicato pede cidade, estado,
 * formação e COREN. Quem cadastra é o balcão, e o balcão tem esses dados — a
 * ficha pela metade era um problema que eu criava para alguém resolver depois.
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
  const [cadastrando, setCadastrando] = useState(false);
  const podeCadastrar = usePodeCadastrarFiliado();

  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCadastrando(false);
    // A busca exige TODOS os termos: o nome inteiro dos autos devolve zero
    // sempre que o cadastro é mais curto. Dois nomes já restringem o bastante
    // e ainda encontram quem tem sobrenome a mais na ficha.
    setBusca((nomeSugerido ?? '').split(/\s+/).slice(0, 2).join(' '));
    setResultados([]);
  }, [open, nomeSugerido]);

  const { data: sugestoes = [], isLoading: carregandoSugestoes } = useQuery({
    queryKey: ['sugestoes-filiado', parteId],
    queryFn: () => sugestoesDeFiliado(parteId as string),
    enabled: open && !!parteId,
    staleTime: 60_000,
  });

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) { setResultados([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      try { setResultados(await buscarFiliados(termo)); }
      catch { setResultados([]); }
      finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  async function vincularId(filiadoId: string) {
    if (parteId) await identificarParteComoFiliado(parteId, filiadoId);
    else await atualizarProcesso(processoId, { filiadoId });
  }

  const vincular = useMutation({
    mutationFn: vincularId,
    onSuccess: () => { toast.success(`${V.Filiado} vinculado ao processo.`); onVinculado(); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível vincular.'),
  });

  async function vincularRecemCadastrado(filiadoId: string) {
    try {
      await vincularId(filiadoId);
      toast.success(`${V.Filiado} cadastrado e vinculado.`);
      onVinculado();
      onClose();
    } catch {
      // O cadastro FOI criado; só o vínculo falhou. Dizer "erro ao cadastrar"
      // faria a pessoa tentar de novo e esbarrar em "CPF já existe".
      toast.error(`${V.Filiado} cadastrado, mas o vínculo falhou. Procure-o na busca.`);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
        onClick={onClose}
      >
        <div
          className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 border-b p-5">
            <div className="min-w-0">
              <h3 className="font-semibold">Vincular {V.filiado}</h3>
              {nomeSugerido && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Parte nos autos: <span className="font-medium text-foreground">{nomeSugerido}</span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
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
              {buscando && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

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
                      {vincular.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 text-brand-700" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {busca.trim().length >= 2 && !buscando && resultados.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground">Nenhum {V.filiado} encontrado.</p>
                {podeCadastrar ? (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setCadastrando(true)}>
                    <UserPlus className="h-4 w-4" /> Cadastrar {V.filiado}
                  </Button>
                ) : (
                  /* O advogado não inclui no cadastro — dizer isso aqui evita
                     a conclusão errada de que a pessoa não é filiada. */
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    Se ela é {V.filiado} e não aparece, peça à secretaria para incluí-la no cadastro.
                  </p>
                )}
              </div>
            )}
          </div>

          <p className="border-t px-4 py-2.5 text-[11px] leading-snug text-muted-foreground">
            O vínculo é opcional — pode ser feito depois, na aba Partes do processo.
          </p>
        </div>
      </div>

      <CadastroFiliadoModal
        open={cadastrando}
        nomeInicial={nomeSugerido}
        onClose={() => setCadastrando(false)}
        onSalvo={vincularRecemCadastrado}
      />
    </>
  );
}

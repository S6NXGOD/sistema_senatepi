'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Landmark, Loader2, Plus, Search, User as UserIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import {
  adicionarParte, criarParteExterna, listarPartesExternas, mascararDocumento,
  formatDocumento, PAPEIS_SUGERIDOS, TIPO_PARTE_LABEL,
  type ParteExterna, type PoloProcesso, type TipoParteExterna,
} from '@/lib/partes';

const campoCls = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm md:h-10';

/** De onde vem a identidade da parte que está sendo adicionada. */
type Fonte = 'CADASTRO' | 'FILIADO' | 'NOVO';

const ICONE_TIPO: Record<TipoParteExterna, typeof Building2> = {
  FISICA: UserIcon,
  JURIDICA: Building2,
  ORGAO_PUBLICO: Landmark,
};

/**
 * Formulário de adição de parte a um processo.
 *
 * As três fontes existem porque as três acontecem de verdade na mesa da equipe:
 *  - CADASTRO: a empresa ré que já processamos dez vezes (PRONTOCARE);
 *  - FILIADO:  o filiado autor — e um processo pode ter vários (ação plúrima);
 *  - NOVO:     a parte que aparece pela primeira vez. Aqui o operador escolhe se
 *              quer só digitar o nome (rápido) ou cadastrar (vira histórico).
 */
export function AdicionarParteForm({
  processoId,
  polo,
  onAdicionada,
  onCancelar,
}: {
  processoId: string;
  polo: PoloProcesso;
  onAdicionada: () => void;
  onCancelar: () => void;
}) {
  // Polo passivo começa no cadastro (o réu costuma se repetir); polo ativo, no
  // filiado (é quase sempre ele quem propõe a ação).
  const [fonte, setFonte] = useState<Fonte>(polo === 'ATIVO' ? 'FILIADO' : 'CADASTRO');
  const [papel, setPapel] = useState(PAPEIS_SUGERIDOS[polo][0] ?? '');

  // ---- Busca no cadastro de partes externas ----
  const [buscaCadastro, setBuscaCadastro] = useState('');
  const [cadastros, setCadastros] = useState<ParteExterna[]>([]);
  const [buscandoCadastro, setBuscandoCadastro] = useState(false);
  const [selecionada, setSelecionada] = useState<ParteExterna | null>(null);

  // ---- Busca de filiados ----
  const [buscaFiliado, setBuscaFiliado] = useState('');
  const [filiados, setFiliados] = useState<FiliadoBusca[]>([]);
  const [buscandoFiliado, setBuscandoFiliado] = useState(false);
  const [filiado, setFiliado] = useState<FiliadoBusca | null>(null);

  // ---- Parte nova ----
  const [tipo, setTipo] = useState<TipoParteExterna>(polo === 'PASSIVO' ? 'JURIDICA' : 'FISICA');
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [salvarNoCadastro, setSalvarNoCadastro] = useState(true);

  useEffect(() => {
    const termo = buscaCadastro.trim();
    if (fonte !== 'CADASTRO') return;
    if (termo.length < 2) { setCadastros([]); return; }
    setBuscandoCadastro(true);
    const t = setTimeout(async () => {
      try { setCadastros((await listarPartesExternas({ busca: termo, pageSize: 8 })).items); }
      catch { setCadastros([]); }
      finally { setBuscandoCadastro(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [buscaCadastro, fonte]);

  useEffect(() => {
    const termo = buscaFiliado.trim();
    if (fonte !== 'FILIADO') return;
    if (termo.length < 2) { setFiliados([]); return; }
    setBuscandoFiliado(true);
    const t = setTimeout(async () => {
      try { setFiliados(await buscarFiliados(termo)); }
      catch { setFiliados([]); }
      finally { setBuscandoFiliado(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [buscaFiliado, fonte]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (fonte === 'CADASTRO') {
        if (!selecionada) throw new Error('Selecione a parte no cadastro.');
        return adicionarParte(processoId, { polo, parteExternaId: selecionada.id, papel });
      }
      if (fonte === 'FILIADO') {
        if (!filiado) throw new Error('Selecione o filiado.');
        return adicionarParte(processoId, { polo, filiadoId: filiado.id, papel });
      }
      // Parte nova: cadastrar primeiro (quando pedido) e então vincular. O
      // cadastro é o que permite, depois, perguntar "quantos processos contra
      // esta empresa?" — mas fica a critério de quem está digitando.
      if (salvarNoCadastro) {
        const criada = await criarParteExterna({
          tipo,
          nome: nome.trim(),
          documento: documento.replace(/\D/g, '') || undefined,
        });
        return adicionarParte(processoId, { polo, parteExternaId: criada.id, papel });
      }
      return adicionarParte(processoId, {
        polo,
        nome: nome.trim(),
        documento: documento.replace(/\D/g, '') || undefined,
        papel,
      });
    },
    onSuccess: () => { toast.success('Parte adicionada.'); onAdicionada(); },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? e?.message ?? 'Não foi possível adicionar a parte.'),
  });

  const podeSalvar =
    fonte === 'CADASTRO' ? !!selecionada
    : fonte === 'FILIADO' ? !!filiado
    : nome.trim().length >= 2;

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      {/* Fonte da parte */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { k: 'CADASTRO' as const, label: 'Do cadastro', icon: Building2 },
          { k: 'FILIADO' as const, label: 'Filiado', icon: UserIcon },
          { k: 'NOVO' as const, label: 'Nova parte', icon: Plus },
        ]).map((f) => {
          const Icon = f.icon;
          return (
            <button
              key={f.k}
              type="button"
              onClick={() => setFonte(f.k)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                fonte === f.k
                  ? 'bg-senatepi-800 text-white shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {f.label}
            </button>
          );
        })}
      </div>

      {/* ---- Do cadastro ---- */}
      {fonte === 'CADASTRO' && (
        selecionada ? (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{selecionada.nome}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {TIPO_PARTE_LABEL[selecionada.tipo]}
                {selecionada.documento ? ` · ${formatDocumento(selecionada.documento)}` : ''}
              </span>
            </span>
            <button type="button" onClick={() => setSelecionada(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              autoFocus
              placeholder="Buscar empresa, órgão ou pessoa já cadastrada…"
              value={buscaCadastro}
              onChange={(e) => setBuscaCadastro(e.target.value)}
            />
            {buscandoCadastro && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
            {cadastros.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-auto rounded-md border bg-card">
                {cadastros.map((c) => {
                  const Icon = ICONE_TIPO[c.tipo];
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => { setSelecionada(c); setBuscaCadastro(''); setCadastros([]); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.nome}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {TIPO_PARTE_LABEL[c.tipo]}
                            {c.documento ? ` · ${formatDocumento(c.documento)}` : ''}
                            {c._count ? ` · ${c._count.participacoes} processo(s)` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {buscaCadastro.trim().length >= 2 && !buscandoCadastro && cadastros.length === 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Nada encontrado.{' '}
                <button
                  type="button"
                  onClick={() => { setFonte('NOVO'); setNome(buscaCadastro.trim()); }}
                  className="font-medium text-senatepi-800 hover:underline dark:text-senatepi-400"
                >
                  Cadastrar "{buscaCadastro.trim()}"
                </button>
              </p>
            )}
          </div>
        )
      )}

      {/* ---- Filiado ---- */}
      {fonte === 'FILIADO' && (
        filiado ? (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{filiado.nome}</span>
              <span className="block truncate text-xs text-muted-foreground">{filiado.cpfMascarado}</span>
            </span>
            <button type="button" onClick={() => setFiliado(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              autoFocus
              placeholder="Buscar filiado por nome ou CPF…"
              value={buscaFiliado}
              onChange={(e) => setBuscaFiliado(e.target.value)}
            />
            {buscandoFiliado && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
            {filiados.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-auto rounded-md border bg-card">
                {filiados.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => { setFiliado(f); setBuscaFiliado(''); setFiliados([]); }}
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{f.nome}</span>
                      <span className="text-xs text-muted-foreground">{f.cpfMascarado}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}

      {/* ---- Parte nova ---- */}
      {fonte === 'NOVO' && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              className={campoCls}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoParteExterna)}
            >
              {(Object.keys(TIPO_PARTE_LABEL) as TipoParteExterna[]).map((t) => (
                <option key={t} value={t}>{TIPO_PARTE_LABEL[t]}</option>
              ))}
            </select>
            <Input
              className="sm:col-span-2"
              autoFocus
              placeholder={tipo === 'FISICA' ? 'Nome completo' : 'Razão social (ex.: PRONTOCARE LTDA)'}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <Input
            placeholder={tipo === 'FISICA' ? 'CPF (opcional)' : 'CNPJ (opcional)'}
            value={documento}
            onChange={(e) => setDocumento(mascararDocumento(e.target.value))}
            inputMode="numeric"
            className="font-mono"
          />
          <label className="flex cursor-pointer select-none items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-senatepi-800"
              checked={salvarNoCadastro}
              onChange={(e) => setSalvarNoCadastro(e.target.checked)}
            />
            <span className="text-muted-foreground">
              <strong className="text-foreground">Salvar no cadastro de partes.</strong> É o que permite
              ver depois todos os processos contra esta parte e o total em causa. Desmarque para apenas
              anotar o nome neste processo.
            </span>
          </label>
        </div>
      )}

      {/* Papel processual (comum a todas as fontes) */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Papel nos autos</label>
        <div className="flex flex-wrap gap-1.5">
          {PAPEIS_SUGERIDOS[polo].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPapel(p)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-medium transition',
                papel === p
                  ? 'bg-senatepi-800 text-white'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <Input
          placeholder="Ou digite outro papel…"
          value={papel}
          onChange={(e) => setPapel(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancelar} disabled={salvar.isPending}>
          Cancelar
        </Button>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || !podeSalvar}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Adicionar parte
        </Button>
      </div>
    </div>
  );
}

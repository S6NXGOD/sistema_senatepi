'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2, Plus, Search, Loader2, Power, PowerOff, Pencil, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { podeEditar } from '@/lib/permissoes';
import { useAuth } from '@/lib/auth';
import {
  TIPO_PARTE_LABEL, atualizarParteExterna, criarParteExterna, formatDocumento,
  listarPartesExternas, type ParteExterna, type TipoParteExterna,
} from '@/lib/partes';

/**
 * ORGANIZAÇÕES — órgãos, empresas e pessoas com quem o sindicato se relaciona.
 *
 * A MESMA entidade em dois papéis: a secretaria que EMPREGA o filiado é a
 * secretaria que figura como RÉ na ação dele. Por isso um cadastro só — e é
 * dele que saem o combobox de empregador e o seletor de partes do processo.
 *
 * POR QUE ESTA TELA EXISTE. O cadastro só era alimentado de dentro de outras
 * telas, e não havia como corrigir um nome nem como aposentar um órgão. Numa
 * reforma administrativa isso vira problema: secretaria é criada, fundida e
 * extinta, e sem esta tela a lista envelhece sem ninguém poder consertar.
 *
 * INATIVAR, NUNCA APAGAR. O órgão extinto continua no vínculo de quem trabalhou
 * nele e nos processos em que figura — apagá-lo reescreveria o passado. Inativo
 * some do autocomplete e permanece no histórico.
 */

const TIPOS: TipoParteExterna[] = ['ORGAO_PUBLICO', 'JURIDICA', 'FISICA'];

export default function OrganizacoesPage() {
  const { user } = useAuth();
  const editavel = podeEditar(user?.role, user?.permissoes, 'processos');

  const [busca, setBusca] = useState('');
  const [aplicado, setAplicado] = useState('');
  const [tipo, setTipo] = useState<TipoParteExterna | ''>('');
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [editando, setEditando] = useState<ParteExterna | 'nova' | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['organizacoes', aplicado, tipo, mostrarInativas],
    queryFn: () =>
      listarPartesExternas({
        busca: aplicado || undefined,
        tipo: tipo || undefined,
        ...(mostrarInativas ? { incluirInativas: 'true' as const } : {}),
        pageSize: 100,
      }),
  });

  async function alternarAtivo(p: ParteExterna) {
    try {
      await atualizarParteExterna(p.id, { ativo: !p.ativo });
      await refetch();
      toast.success(p.ativo ? `${rotulo(p)} inativada.` : `${rotulo(p)} reativada.`);
    } catch {
      toast.error('Não foi possível alterar.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <Building2 className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Organizações</h2>
            <p className="text-sm text-muted-foreground">
              Órgãos e empresas — empregadores dos filiados e partes dos processos
            </p>
          </div>
        </div>
        {editavel && (
          <Button onClick={() => setEditando('nova')}>
            <Plus className="h-4 w-4" /> Nova organização
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="Buscar por nome ou sigla…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setAplicado(busca.trim()); }}
            />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoParteExterna | '')}
          >
            <option value="">Todos os tipos</option>
            {TIPOS.map((t) => <option key={t} value={t}>{TIPO_PARTE_LABEL[t]}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mostrarInativas}
              onChange={(e) => setMostrarInativas(e.target.checked)}
            />
            Mostrar inativas
          </label>
          <Button variant="outline" onClick={() => setAplicado(busca.trim())}>Buscar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-brand-800 dark:text-brand-400" />
            </div>
          ) : !data?.items.length ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nenhuma organização encontrada.
            </p>
          ) : (
            <ul className="divide-y">
              {data.items.map((p) => (
                <li
                  key={p.id}
                  className={cn('flex items-center gap-3 px-4 py-3', !p.ativo && 'opacity-55')}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.nomeFantasia && (
                        <span className="mr-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {p.nomeFantasia}
                        </span>
                      )}
                      {p.nome}
                      {!p.ativo && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          · inativa
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {TIPO_PARTE_LABEL[p.tipo]}
                      {p.documento ? ` · ${formatDocumento(p.documento)}` : ''}
                      {p.cidade ? ` · ${p.cidade}${p.uf ? `-${p.uf}` : ''}` : ''}
                    </p>
                  </div>
                  {editavel && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        title="Editar"
                        onClick={() => setEditando(p)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title={p.ativo ? 'Inativar (some do autocomplete, fica no histórico)' : 'Reativar'}
                        onClick={() => alternarAtivo(p)}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted',
                          p.ativo ? 'text-muted-foreground' : 'text-emerald-600',
                        )}
                      >
                        {p.ativo ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data && data.items.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {data.items.length} de {data.total} · organização extinta deve ser{' '}
          <strong>inativada</strong>, nunca apagada — ela continua nos vínculos e nos
          processos em que figura.
        </p>
      )}

      {editando && (
        <FormOrganizacao
          inicial={editando === 'nova' ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={async () => { setEditando(null); await refetch(); }}
        />
      )}
    </div>
  );
}

const rotulo = (p: ParteExterna) => p.nomeFantasia || p.nome;

function FormOrganizacao({
  inicial,
  onFechar,
  onSalvo,
}: {
  inicial: ParteExterna | null;
  onFechar: () => void;
  onSalvo: () => void | Promise<void>;
}) {
  const [f, setF] = useState({
    tipo: (inicial?.tipo ?? 'ORGAO_PUBLICO') as TipoParteExterna,
    nome: inicial?.nome ?? '',
    nomeFantasia: inicial?.nomeFantasia ?? '',
    documento: inicial?.documento ?? '',
    cidade: inicial?.cidade ?? '',
    uf: inicial?.uf ?? '',
  });
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function salvar() {
    if (!f.nome.trim() || salvando) return;
    setSalvando(true);
    try {
      const dto = {
        tipo: f.tipo,
        nome: f.nome.trim(),
        nomeFantasia: f.nomeFantasia.trim() || undefined,
        documento: f.documento.replace(/\D/g, '') || undefined,
        cidade: f.cidade.trim() || undefined,
        uf: f.uf.trim().toUpperCase() || undefined,
      };
      if (inicial) await atualizarParteExterna(inicial.id, dto);
      else await criarParteExterna(dto);
      toast.success(inicial ? 'Organização atualizada.' : 'Organização cadastrada.');
      await onSalvo();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : msg ?? 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">
              {inicial ? 'Editar organização' : 'Nova organização'}
            </h3>
            <button type="button" onClick={onFechar} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tipo</label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={f.tipo}
              onChange={(e) => set('tipo', e.target.value)}
            >
              {TIPOS.map((t) => <option key={t} value={t}>{TIPO_PARTE_LABEL[t]}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nome / Razão social *</label>
            <Input
              placeholder="Ex.: Secretaria Municipal de Educação"
              value={f.nome}
              onChange={(e) => set('nome', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Sigla</label>
              {/* É a sigla que a pessoa digita no autocomplete e que aparece
                  no cadastro do filiado — "SEMEC", não a razão social inteira. */}
              <Input placeholder="Ex.: SEMEC" value={f.nomeFantasia} onChange={(e) => set('nomeFantasia', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">CNPJ / CPF</label>
              <Input placeholder="Opcional" value={f.documento} onChange={(e) => set('documento', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Cidade</label>
              <Input value={f.cidade} onChange={(e) => set('cidade', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">UF</label>
              <Input maxLength={2} value={f.uf} onChange={(e) => set('uf', e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button onClick={salvar} disabled={!f.nome.trim() || salvando}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

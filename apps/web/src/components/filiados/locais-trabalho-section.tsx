'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Search, Loader2, CreditCard, Building2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { listarPartesExternas, TIPO_PARTE_LABEL, type ParteExterna } from '@/lib/partes';
import { tenant } from '@/tenant.config';

/** Local de trabalho enquanto está sendo editado. */
export interface LocalTrabalho {
  empresa: string;
  /** Id no cadastro de organizações, quando escolhido no combobox. */
  parteExternaId?: string;
  cargo?: string;
  /** Onde a pessoa trabalha DENTRO do órgão — secretaria, unidade, setor. */
  lotacao?: string;
  matricula?: string;
  descontoEmFolha?: boolean;
}

/**
 * Cargos da categoria que ESTE sindicato representa.
 *
 * Estavam escritos aqui, com os três da enfermagem — e o cadastro de um
 * sindicato de servidores municipais oferecia «Enfermeiro(a)» a alguém da
 * Secretaria de Finanças. Agora saem do tenant: lista fechada onde a categoria
 * é fechada (é o que permite contar "quantos técnicos temos na FMS?"), campo
 * digitado onde não é.
 */
export const CARGOS_CATEGORIA = tenant.cargos ?? [];

const sel = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

/**
 * Combobox do empregador.
 *
 * Busca no cadastro de organizações (o MESMO usado nas partes de processo — a
 * FMS que emprega é a FMS que é ré), mas aceita texto livre: exigir cadastro
 * prévio travaria o atendimento por causa de um hospital que ninguém cadastrou
 * ainda. O nome digitado é sempre gravado; o vínculo com a organização é o
 * bônus quando existe.
 */
function BuscaEmpregador({
  valor,
  vinculado,
  onEscolher,
  onDigitar,
}: {
  valor: string;
  vinculado?: string;
  onEscolher: (p: ParteExterna) => void;
  onDigitar: (nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState<ParteExterna[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    const termo = busca.trim();
    if (!aberto || termo.length < 2) { setItens([]); return; }
    setCarregando(true);
    const t = setTimeout(async () => {
      try { setItens((await listarPartesExternas({ busca: termo, pageSize: 6 })).items); }
      catch { setItens([]); }
      finally { setCarregando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca, aberto]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          value={valor}
          // Sem exemplo cravado: "HU-UFPI" é hospital federal e não diz nada a um
          // sindicato de servidores municipais. A lista real vem do cadastro.
          placeholder="Digite o nome ou a sigla do empregador…"
          onChange={(e) => { onDigitar(e.target.value); setBusca(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
        />
        {carregando && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {aberto && itens.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-md border border-input bg-card shadow-lg">
            {itens.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => { onEscolher(p); setBusca(''); setItens([]); setAberto(false); }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.nomeFantasia || p.nome}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {TIPO_PARTE_LABEL[p.tipo]}
                      {p.nomeFantasia ? ` · ${p.nome}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {vinculado ? (
        <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          <Building2 className="h-3 w-3" /> Vinculado ao cadastro de organizações
        </p>
      ) : valor.trim() ? (
        <p className="text-[11px] text-muted-foreground">
          Texto livre — sem vínculo com o cadastro. Escolha da lista para cruzar com processos.
        </p>
      ) : null}
    </div>
  );
}

/**
 * LOCAIS DE TRABALHO do filiado.
 *
 * Duplo vínculo é a regra na enfermagem, então a lista não tem limite. O switch
 * "desconto nesta folha" fica em CADA local porque quem tem dois empregos
 * costuma ter desconto em um só — e o financeiro precisa saber em qual.
 */
export function LocaisTrabalhoSection({
  locais,
  onChange,
  /** Modalidade escolhida no filiado — usada só para avisar sobre incoerência. */
  modalidade,
}: {
  locais: LocalTrabalho[];
  onChange: (l: LocalTrabalho[]) => void;
  modalidade?: string;
}) {
  const mudar = (i: number, campo: keyof LocalTrabalho, valor: unknown) =>
    onChange(locais.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  const comDesconto = locais.filter((l) => l.descontoEmFolha).length;
  // Incoerência que o financeiro sofreria depois: modalidade diz folha, mas
  // nenhum local aponta onde. Avisa, não bloqueia — o cadastro pode estar em
  // andamento e o operador sabe o que está fazendo.
  const avisoIncoerente = modalidade === 'DESCONTO_FOLHA' && comDesconto === 0 && locais.length > 0;

  return (
    <div className="space-y-4">
      {locais.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nenhum local de trabalho cadastrado.
        </p>
      )}

      {avisoIncoerente && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          A modalidade é <strong>Desconto em Folha</strong>, mas nenhum local está marcado. Marque em
          qual folha o desconto acontece — senão o financeiro não saberá onde cobrar.
        </p>
      )}

      {locais.map((l, i) => (
        <div
          key={i}
          className={cn(
            'space-y-4 rounded-xl border p-4 transition',
            l.descontoEmFolha ? 'border-brand-400 bg-brand-50/40 dark:bg-brand-900/10' : 'bg-muted/30',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Local {i + 1}
            </span>
            <button
              type="button"
              onClick={() => onChange(locais.filter((_, j) => j !== i))}
              className="flex items-center gap-1 text-xs text-red-600 hover:underline dark:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remover
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <label className="text-sm font-medium">Empresa / Órgão empregador</label>
              <BuscaEmpregador
                valor={l.empresa ?? ''}
                vinculado={l.parteExternaId}
                onEscolher={(p) => {
                  onChange(
                    locais.map((x, j) =>
                      j === i
                        ? { ...x, empresa: p.nomeFantasia || p.nome, parteExternaId: p.id }
                        : x,
                    ),
                  );
                }}
                // Digitar à mão desfaz o vínculo: o texto passa a não
                // corresponder mais à organização escolhida.
                onDigitar={(nome) =>
                  onChange(
                    locais.map((x, j) => (j === i ? { ...x, empresa: nome, parteExternaId: undefined } : x)),
                  )
                }
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {CARGOS_CATEGORIA.length ? 'Cargo / Função' : 'Cargo / Carreira / Especialidade'}
              </label>

              {CARGOS_CATEGORIA.length > 0 ? (
                <>
                  <select
                    className={sel}
                    value={CARGOS_CATEGORIA.includes(l.cargo ?? '') ? l.cargo : (l.cargo ? '__OUTRO__' : '')}
                    onChange={(e) =>
                      mudar(i, 'cargo', e.target.value === '__OUTRO__' ? ' ' : e.target.value)
                    }
                  >
                    <option value="">Selecione…</option>
                    {CARGOS_CATEGORIA.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="__OUTRO__">Outro (especificar)</option>
                  </select>
                  {/* Escape para o caso atípico — enfermeiro em cargo administrativo. */}
                  {l.cargo !== undefined && l.cargo !== '' && !CARGOS_CATEGORIA.includes(l.cargo) && (
                    <Input
                      className="mt-1.5"
                      placeholder="Qual o cargo?"
                      value={l.cargo.trim()}
                      onChange={(e) => mudar(i, 'cargo', e.target.value)}
                    />
                  )}
                </>
              ) : (
                /**
                 * Sem lista fechada, o campo é digitado — e o rótulo muda junto.
                 * Um sindicato de servidores tem centenas de carreiras no plano
                 * de cargos do município; oferecer um select seria uma lista
                 * impossível de manter, e foi assim que o cadastro do SINDSERM
                 * chegou a oferecer «Enfermeiro(a)» a um servidor das Finanças.
                 */
                <Input
                  placeholder="Ex.: Professor, Agente de Trânsito, Auxiliar Administrativo…"
                  value={l.cargo ?? ''}
                  onChange={(e) => mudar(i, 'cargo', e.target.value)}
                />
              )}
            </div>

            <div className="space-y-1.5">
              {/* LOTAÇÃO é o lugar DENTRO do órgão. O campo acima ("Local de
                  trabalho") guarda o empregador; num sindicato de servidores é
                  pela lotação que a base se organiza — e é ela que responde
                  "quantos filiados temos na Secretaria de Saúde?". */}
              <label className="text-sm font-medium">Lotação</label>
              <Input
                placeholder="Secretaria, unidade ou setor"
                value={l.lotacao ?? ''}
                onChange={(e) => mudar(i, 'lotacao', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Matrícula funcional</label>
              <Input
                placeholder="Opcional"
                value={l.matricula ?? ''}
                onChange={(e) => mudar(i, 'matricula', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Contribuição</label>
              <label className="flex h-12 cursor-pointer items-center gap-2 rounded-md border border-input px-3 md:h-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-700"
                  checked={!!l.descontoEmFolha}
                  onChange={(e) => mudar(i, 'descontoEmFolha', e.target.checked)}
                />
                <span className="flex items-center gap-1.5 text-sm">
                  <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                  Desconto nesta folha
                </span>
              </label>
            </div>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => onChange([...locais, { empresa: '', cargo: '', matricula: '', descontoEmFolha: false }])}
      >
        <Plus className="h-4 w-4" /> Adicionar Local de Trabalho
      </Button>
    </div>
  );
}

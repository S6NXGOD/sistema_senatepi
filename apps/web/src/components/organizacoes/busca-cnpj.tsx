'use client';

import { useState } from 'react';
import {
  Search, Loader2, CheckCircle2, AlertTriangle, Landmark, Building2, ArrowRight, Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AvisoDuplicatas } from './aviso-duplicatas';
import {
  consultarCnpj, formatDocumento, type ConsultaCnpj, type ParteExterna, type ParteParecida,
} from '@/lib/partes';

/**
 * BUSCA POR CNPJ — o mesmo bloco para Organizações e para partes do processo.
 *
 * POR QUE ISTO É ANTIDUPLICAÇÃO, E NÃO PREENCHIMENTO.
 *
 * Preencher o formulário sozinho é o efeito visível; o valor está no que
 * acontece ANTES. A duplicata não nasce por descuido — nasce porque quem
 * cadastra não tem como saber que a organização já existe com outro nome.
 * "PRONTOCARE" e "PRONTOCARE CLINICA E ATENDIMENTOS LTDA" são o mesmo CNPJ e
 * viraram dois cadastros; a partir daí "quantos processos temos contra esta
 * empresa" passa a ter duas respostas erradas.
 *
 * A RESPOSTA TEM UMA ORDEM, e ela é a hierarquia da tela:
 *
 *   1. JÁ CADASTRADA (mesmo CNPJ) — não há decisão a tomar, é a mesma.
 *   2. Os DADOS DA RECEITA, para preencher.
 *   3. PARECIDAS por nome — suspeita, e por isso vem por último e sem alarme.
 *
 * `mostrarParecidas={false}` para quem já exibe o aviso de duplicatas por conta
 * própria: duas caixas iguais na mesma tela ensinam a pessoa a ignorar as duas.
 * A lista continua chegando em `onEncontrado`, no payload da consulta.
 *
 * A CONSULTA NUNCA É OBRIGATÓRIA. A Receita é serviço público e gratuito: cai,
 * limita requisição, demora. Toda falha vira aviso em português e o cadastro
 * manual segue exatamente como era.
 */
export function BuscaCnpj({
  onEncontrado,
  onAbrirExistente,
  mostrarParecidas = true,
  className,
}: {
  onEncontrado: (d: ConsultaCnpj) => void;
  onAbrirExistente?: (p: ParteExterna | ParteParecida) => void;
  mostrarParecidas?: boolean;
  className?: string;
}) {
  const [cnpj, setCnpj] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [r, setR] = useState<ConsultaCnpj | null>(null);

  const digitos = cnpj.replace(/\D/g, '');

  async function buscar() {
    if (digitos.length !== 14) return toast.error('Informe os 14 dígitos do CNPJ.');
    setBuscando(true);
    setR(null);
    try {
      const dados = await consultarCnpj(digitos);
      setR(dados);
      // Só entrega os dados quando NÃO existe cadastro com este CNPJ: preencher
      // em cima de uma organização já cadastrada é convidar a duplicata que
      // viemos evitar.
      if (!dados.jaCadastrada) onEncontrado(dados);
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(m ?? 'Não foi possível consultar o CNPJ. Preencha os dados manualmente.');
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            inputMode="numeric"
            placeholder="Buscar CNPJ na Receita Federal"
            value={cnpj}
            onChange={(e) => setCnpj(mascararCnpj(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }}
            className="pl-9 font-mono"
          />
        </div>
        <Button type="button" variant="outline" onClick={buscar} disabled={buscando || digitos.length !== 14}>
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="hidden sm:inline">Buscar</span>
        </Button>
      </div>

      {/* 1. JÁ EXISTE — resposta definitiva, nada a decidir. */}
      {r?.jaCadastrada && (
        <div className="rounded-lg border border-amber-400 bg-amber-50/70 p-3 dark:border-amber-700 dark:bg-amber-950/25">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Esta organização já está cadastrada
          </p>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/70 px-2.5 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{r.jaCadastrada.nome}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {formatDocumento(r.cnpj)}
                {r.jaCadastrada.cidade ? ` · ${r.jaCadastrada.cidade}` : ''}
                {r.jaCadastrada.dossiePatronal ? ' · contribuinte patronal' : ''}
              </span>
            </span>
            {onAbrirExistente && (
              <button
                type="button"
                onClick={() => onAbrirExistente(r.jaCadastrada!)}
                className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-800 hover:underline dark:text-brand-400"
              >
                usar esta <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. O RESULTADO DA RECEITA. */}
      {r && !r.jaCadastrada && <CartaoReceita r={r} />}

      {/* 3. PARECIDAS — suspeita, por último e sem cor de alarme. */}
      {mostrarParecidas && !r?.jaCadastrada && !!r?.parecidas.length && onAbrirExistente && (
        <AvisoDuplicatas candidatos={r.parecidas} onUsar={onAbrirExistente} />
      )}
    </div>
  );
}

/**
 * O CARTÃO DA RECEITA.
 *
 * A primeira versão era uma lista de definição de duas colunas larga: rótulo
 * encostado à esquerda, valor à direita, e um vão de dez centímetros entre os
 * dois. Ler exigia percorrer a linha inteira com o dedo, e eram seis linhas.
 *
 * Agora o NOME é o título — é ele que responde "achei quem eu queria?" — com a
 * situação cadastral como etiqueta ao lado. Os detalhes viram pares compactos
 * com o rótulo miúdo EM CIMA do valor: o olho lê de cima para baixo em vez de
 * atravessar a caixa, e cabem três por linha no mesmo espaço.
 */
function CartaoReceita({ r }: { r: ConsultaCnpj }) {
  const orgao = r.tipoSugerido === 'ORGAO_PUBLICO';
  const Icone = orgao ? Landmark : Building2;

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        r.ativaNaReceita
          ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/25'
          : 'border-red-300 bg-red-50/70 dark:border-red-800 dark:bg-red-950/25',
      )}
    >
      <div className="flex items-start gap-2">
        {r.ativaNaReceita
          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          : <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">{r.razaoSocial}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-mono">{formatDocumento(r.cnpj)}</span>
            {r.situacao && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide',
                  r.ativaNaReceita
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                    : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
                )}
              >
                {r.situacao}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Icone className="h-3 w-3" />
              {orgao ? 'órgão público' : 'pessoa jurídica'}
            </span>
          </p>
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-current/10 pt-2 sm:grid-cols-3">
        <Par rotulo="Nome fantasia" valor={r.nomeFantasia} />
        <Par rotulo="Cidade" valor={[r.cidade, r.uf].filter(Boolean).join(' - ')} />
        <Par rotulo="Abertura" valor={r.dataAbertura?.split('-').reverse().join('/')} />
        <Par rotulo="Natureza" valor={r.naturezaJuridica} />
        <Par rotulo="Atividade" valor={r.atividadePrincipal} className="sm:col-span-2" />
      </dl>

      {/*
        O AVISO DE INSCRIÇÃO IRREGULAR é o mais valioso da tela e o mais fácil de
        esquecer: processar empresa BAIXADA muda a estratégia (redirecionar aos
        sócios), e cobrar repasse de quem encerrou é trabalho perdido. A Receita
        sabe disso e ninguém pergunta.
      */}
      {!r.ativaNaReceita && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-red-100/70 px-2 py-1.5 text-[11px] font-medium text-red-900 dark:bg-red-900/30 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Inscrição {r.situacao?.toLowerCase() ?? 'irregular'} na Receita. Confira antes de ajuizar
          ou lançar contribuição — pode ser preciso redirecionar a ação aos sócios.
        </p>
      )}
    </div>
  );
}

/** Rótulo miúdo em cima, valor embaixo — some inteiro quando não há valor. */
function Par({ rotulo, valor, className }: { rotulo: string; valor?: string | null; className?: string }) {
  if (!valor) return null;
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-[12px] font-medium" title={valor}>{valor}</dd>
    </div>
  );
}

/** 00.000.000/0000-00 conforme se digita. */
export function mascararCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

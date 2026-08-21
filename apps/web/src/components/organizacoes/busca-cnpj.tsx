'use client';

import { useState } from 'react';
import { Search, Loader2, CheckCircle2, AlertTriangle, Building2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  consultarCnpj, formatDocumento, MOTIVO_SEMELHANCA_LABEL,
  type ConsultaCnpj, type ParteExterna,
} from '@/lib/partes';

/**
 * BUSCA POR CNPJ — o mesmo bloco para Organizações e para partes do processo.
 *
 * POR QUE ISTO É UM COMPONENTE DE ANTIDUPLICAÇÃO, E NÃO DE PREENCHIMENTO.
 *
 * Preencher o formulário sozinho é o efeito visível; o valor está no que
 * acontece ANTES disso. A duplicata não nasce por descuido — nasce porque quem
 * cadastra não tem como saber que a organização já existe com outro nome.
 * "PRONTOCARE" e "PRONTOCARE CLINICA E ATENDIMENTOS LTDA" são o mesmo CNPJ e
 * viraram dois cadastros; a partir daí "quantos processos temos contra esta
 * empresa" — a razão de o cadastro existir — passa a ter duas respostas erradas.
 *
 * Então a resposta é lida em três níveis, do mais forte para o mais fraco:
 *
 *  1. JÁ CADASTRADA (mesmo CNPJ) — é a mesma organização, ponto. A tela para de
 *     oferecer criação e oferece abrir. Não há decisão a tomar aqui.
 *  2. PARECIDAS (nome semelhante, sem o mesmo documento) — é o cadastro antigo
 *     feito só pelo nome, antes de alguém ter o CNPJ. Aqui a consulta vira uma
 *     oportunidade de MESCLAR, e a tela diz isso com essas palavras.
 *  3. Os dados da Receita, para preencher.
 *
 * A CONSULTA NUNCA É OBRIGATÓRIA. A Receita é serviço público e gratuito: cai,
 * limita requisição, demora. Toda falha vira aviso em português e o cadastro
 * manual continua exatamente como era — nada aqui bloqueia o caminho de quem
 * está com pressa ou com a parte que nem CNPJ tem.
 */
export function BuscaCnpj({
  onEncontrado,
  onAbrirExistente,
  className,
}: {
  /** Dados da Receita aceitos pela pessoa — a tela decide o que fazer com eles. */
  onEncontrado: (d: ConsultaCnpj) => void;
  /** Clique em "abrir" numa organização que já existe. */
  onAbrirExistente?: (p: ParteExterna) => void;
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
      // Só entrega os dados para o formulário quando NÃO existe cadastro com
      // este CNPJ. Preencher em cima de uma organização já cadastrada é
      // convidar a pessoa a criar a duplicata que viemos evitar.
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
      <label className="text-sm font-medium">Buscar na Receita Federal</label>
      <div className="flex gap-2">
        <Input
          inputMode="numeric"
          placeholder="00.000.000/0000-00"
          value={cnpj}
          onChange={(e) => setCnpj(mascararCnpj(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }}
          className="font-mono"
        />
        <Button type="button" variant="outline" onClick={buscar} disabled={buscando || digitos.length !== 14}>
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Buscar
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Preenche razão social, nome fantasia, cidade e UF — e avisa se a organização já existe aqui.
        Opcional: dá para cadastrar tudo à mão.
      </p>

      {/* 1. JÁ EXISTE — a resposta definitiva, nada a decidir. */}
      {r?.jaCadastrada && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Esta organização já está cadastrada
          </p>
          <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">
            <span className="font-medium">{r.jaCadastrada.nome}</span>
            {r.jaCadastrada.cidade ? ` · ${r.jaCadastrada.cidade}` : ''}
            {r.jaCadastrada.dossiePatronal ? ' · contribuinte patronal' : ''}
          </p>
          {onAbrirExistente && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => onAbrirExistente(r.jaCadastrada!)}
            >
              Abrir esta organização <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* 2. PARECIDAS — aqui há decisão, e ela é "mesclar", não "criar". */}
      {!r?.jaCadastrada && !!r?.parecidas.length && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Já existe cadastro com nome parecido
          </p>
          <p className="mt-0.5 text-[11px] text-amber-900/80 dark:text-amber-200/80">
            Provavelmente é a MESMA organização, cadastrada antes de alguém ter o CNPJ.
            Se for, abra a que já existe e informe o CNPJ nela — em vez de criar outra.
          </p>
          <ul className="mt-2 space-y-1">
            {r.parecidas.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {p.nome}
                  <span className="ml-1 text-[11px] text-amber-800/70 dark:text-amber-300/70">
                    ({MOTIVO_SEMELHANCA_LABEL[p.motivo]})
                  </span>
                </span>
                {onAbrirExistente && (
                  <button
                    type="button"
                    onClick={() => onAbrirExistente(p)}
                    className="shrink-0 text-xs font-semibold underline-offset-2 hover:underline"
                  >
                    abrir
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. ENCONTRADA E NOVA — o caminho feliz. */}
      {r && !r.jaCadastrada && (
        <div
          className={cn(
            'rounded-lg border p-3',
            r.ativaNaReceita
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
              : 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30',
          )}
        >
          <p
            className={cn(
              'flex items-center gap-1.5 text-sm font-semibold',
              r.ativaNaReceita
                ? 'text-emerald-900 dark:text-emerald-300'
                : 'text-red-900 dark:text-red-300',
            )}
          >
            {r.ativaNaReceita ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {r.razaoSocial}
          </p>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <Linha rotulo="CNPJ" valor={formatDocumento(r.cnpj)} />
            <Linha rotulo="Situação" valor={r.situacao} />
            <Linha rotulo="Natureza" valor={r.naturezaJuridica} />
            <Linha rotulo="Atividade" valor={r.atividadePrincipal} />
            <Linha rotulo="Cidade" valor={[r.cidade, r.uf].filter(Boolean).join(' - ')} />
            <Linha rotulo="Abertura" valor={r.dataAbertura} />
          </dl>
          {/*
            O aviso de situação irregular é o mais valioso desta tela e o mais
            fácil de esquecer: processar uma empresa BAIXADA muda a estratégia
            (redirecionar para os sócios), e cobrar repasse de quem encerrou é
            trabalho perdido. A Receita sabe disso e ninguém pergunta.
          */}
          {!r.ativaNaReceita && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] font-medium text-red-800 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              A inscrição NÃO está ativa na Receita ({r.situacao ?? 'situação irregular'}).
              Confira antes de ajuizar ou de lançar contribuição — pode ser preciso
              redirecionar a ação aos sócios.
            </p>
          )}
          {r.naturezaJuridica && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Building2 className="h-3 w-3 shrink-0" />
              Classificada como{' '}
              <strong className="font-semibold">
                {r.tipoSugerido === 'ORGAO_PUBLICO' ? 'órgão público' : 'pessoa jurídica'}
              </strong>{' '}
              pela natureza jurídica — dá para trocar no campo abaixo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  if (!valor) return null;
  return (
    <>
      <dt className="font-medium">{rotulo}</dt>
      <dd className="truncate" title={valor}>{valor}</dd>
    </>
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

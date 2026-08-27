'use client';

import { Landmark, Scale } from 'lucide-react';

import { formatNPU } from '@/lib/processos';
import type { ProcessoRef } from '@/lib/agenda';
import { cn } from '@/lib/utils';

/**
 * DE QUAL PROCESSO É ESTA ATIVIDADE.
 *
 * O DEFEITO, visto numa tela real: dois cartões lado a lado, ambos
 * "Verificação de Intimação / Prazo", mesma data, mesmo advogado, e nada que
 * dissesse de qual processo cada um era. Eram processos diferentes — o robô
 * agrupa por processo e por dia, então dois cartões iguais SÃO dois casos.
 * Para quem olhava, era um só duplicado.
 *
 * POR QUE NÃO CONSERTEI NO TÍTULO, que era o caminho óbvio:
 *
 *  1. O título fica GRAVADO. Mudar o gerador só arruma o que nascer daqui em
 *     diante; os cartões que já existem continuam gêmeos.
 *  2. Parte de processo MUDA. O réu é cadastrado depois, uma organização é
 *     mesclada e troca de nome. Um título congelado passaria a mentir.
 *  3. "Verificação de Intimação / Prazo" é SENTINELA: a correlação com o DJEN
 *     compara essa string exata para saber que o título ainda é genérico e pode
 *     ser promovido a algo específico ("Contestação", "Manifestação"). Trocá-la
 *     por descuido desligaria essa promoção em silêncio.
 *
 * Derivar na tela resolve os três: vale para o acervo inteiro, acompanha o
 * cadastro e não toca na sentinela.
 *
 * QUEM CONTRA QUEM, e não o NPU. Ninguém decora vinte dígitos; todo mundo
 * lembra "aquele contra a Prefeitura de Água Branca". O NPU fica no `title` do
 * elemento, para quem precisa copiar.
 *
 * O AUTOR ENCOLHE, O RÉU NÃO. Este é o detalhe que faz a linha funcionar num
 * celular. "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO
 * PIAUÍ × Município de Agricolândia" não cabe em 300px, e com um `truncate`
 * comum o que sumiria é o FIM — exatamente o réu, a única metade que
 * diferencia um cartão do outro. Com `min-w-0 truncate` no autor e `shrink-0`
 * no réu, a truncagem come a parte previsível: "SINDICATO DOS ENFERM… ×
 * Município de Agricolândia".
 */
/**
 * A MESMA IDENTIDADE EM UMA STRING, para onde não cabe um componente.
 *
 * A linha do painel e a célula do calendário têm espaço para meia dúzia de
 * palavras — no calendário, para nenhuma: ali isto vira só o `title` do
 * elemento. Devolve `null` quando não há nada útil a dizer, para o chamador
 * simplesmente não renderizar o separador.
 *
 * Leva a PARTE CONTRÁRIA, e não o confronto inteiro: nesses dois lugares o
 * espaço não comporta os dois lados, e o lado que identifica é sempre o outro —
 * o nosso já está no `Filiado:` ao lado, ou é o próprio sindicato.
 */
export function parteContrariaDoProcesso(
  processo: ProcessoRef | null | undefined,
): string | null {
  const reu = (processo?.partes ?? []).find((p) => p.polo === 'PASSIVO');
  if (reu) return reu.nome;
  // Sem réu cadastrado, o rótulo do caso ainda diz mais que nada.
  return processo?.titulo || null;
}

export function IdentidadeDoProcesso({
  processo,
  className,
}: {
  processo: ProcessoRef | null | undefined;
  className?: string;
}) {
  if (!processo) return null;

  const partes = processo.partes ?? [];
  // A primeira de cada polo É a principal — `PARTE_ORDER` garante isso no back.
  const autor = partes.find((p) => p.polo === 'ATIVO');
  const reu = partes.find((p) => p.polo === 'PASSIVO');
  const outrosPassivo = Math.max(0, partes.filter((p) => p.polo === 'PASSIVO').length - 1);

  const npu = processo.numeroCNJ ? formatNPU(processo.numeroCNJ) : null;
  const institucional = processo.tipoAcao === 'INSTITUCIONAL';

  /**
   * SEM PARTES CADASTRADAS o cartão cai no que existir: o rótulo do caso
   * pré-processual, ou o NPU. Some por completo só quando não há nem isso —
   * uma linha dizendo "processo sem identificação" seria ruído por ruído.
   */
  if (!autor && !reu) {
    const alternativa = processo.titulo || npu;
    if (!alternativa) return null;
    return (
      <p
        className={cn('flex items-center gap-1 text-xs text-muted-foreground', className)}
        title={npu ?? undefined}
      >
        {institucional ? (
          <Landmark className="h-3 w-3 shrink-0" />
        ) : (
          <Scale className="h-3 w-3 shrink-0" />
        )}
        <span className="truncate">{alternativa}</span>
      </p>
    );
  }

  const completo = [
    autor?.nome ?? 'Autor não informado',
    '×',
    reu?.nome ?? 'réu não cadastrado',
    npu ? `· ${npu}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <p
      className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', className)}
      // O NPU inteiro fica aqui: quem precisa copiar o número passa o mouse, e
      // quem só quer saber de que caso se trata lê a linha.
      title={completo}
    >
      {institucional ? (
        <Landmark className="h-3 w-3 shrink-0 text-brand-700 dark:text-brand-400" />
      ) : (
        <Scale className="h-3 w-3 shrink-0" />
      )}

      {/* O autor cede espaço — ver o comentário do topo. */}
      <span className="min-w-0 truncate">
        {autor?.nome ?? <span className="italic">autor não informado</span>}
      </span>

      <span className="shrink-0 font-semibold">×</span>

      {/*
        O RÉU É O QUE DIFERENCIA. `shrink-0` até 60% da largura: sem teto, um
        réu de nome quilométrico empurraria o autor para dois caracteres e a
        linha ficaria ilegível dos dois lados.
      */}
      <span className="max-w-[60%] shrink-0 truncate font-medium text-foreground">
        {reu?.nome ?? <span className="font-normal not-italic text-amber-700 dark:text-amber-400">réu não cadastrado</span>}
        {outrosPassivo > 0 && <span className="font-normal text-muted-foreground"> +{outrosPassivo}</span>}
      </span>
    </p>
  );
}

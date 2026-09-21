'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, IdCard, Send, UserCog } from 'lucide-react';
import { EnviarLinkModal } from '@/components/filiados/enviar-link-modal';
import { cn } from '@/lib/utils';
import { V } from '@/lib/vocabulario';
import {
  fraseDoCadastroIncompleto,
  gravidadeDoCadastro,
  listarEmPortugues,
  oQueFaltaNoCadastro,
  podeMandarLink,
  type CadastroDoFiliado,
} from '@/lib/cadastro-incompleto';

/**
 * O AVISO QUE COBRA O RECADASTRAMENTO NA HORA DO ATENDIMENTO — 21/09/2026.
 *
 * "Temos que ser mais incisivos com isso para que a triagem sempre seja
 * induzida a pedir o filiado para se recadastrar."
 *
 * INCISIVO É TER SAÍDA, não ser vermelho. A regra da casa para faixa vale aqui:
 * consequência na frente, uma alavanca, e tom proporcional ao dano. Então:
 *
 *  · a frase diz o que falta, com nome ("Falta CPF e telefone"), nunca
 *    "cadastro desatualizado" — que não diz o que fazer;
 *  · os dois caminhos ficam à vista, porque são os dois jeitos reais de
 *    resolver: mandar o link (a pessoa preenche do celular dela) ou preencher
 *    ali mesmo, com ela na frente;
 *  · âmbar, não vermelho. Vermelho é do Excluir; cadastro furado pede alguém,
 *    não anuncia estrago.
 *
 * SEM TELEFONE E SEM E-MAIL NÃO HÁ PARA ONDE MANDAR O LINK, e o botão some em
 * vez de mentir — sobra o presencial, que é a saída real desse caso.
 *
 * NÃO APARECE QUANDO NÃO FALTA NADA. Aviso que aparece sempre é cabeçalho.
 */
export function AvisoCadastroIncompleto({
  filiado,
  filiadoId,
  nome,
  compacto,
  className,
}: {
  filiado: CadastroDoFiliado | null | undefined;
  filiadoId: string;
  /** Vai no cabeçalho do modal do link — confirma de quem é, no meio do atendimento. */
  nome?: string | null;
  /** Na gaveta do atendimento o espaço é menor: some a explicação longa. */
  compacto?: boolean;
  className?: string;
}) {
  /*
    O LINK ABRE EM MODAL, e não numa outra tela (21/09/2026).

    "Quando clico em mandar link de recadastro, não gera link nenhum, na verdade
    vai pra tela do filiado detalhado." Era um `Link` para a ficha: quem clicava
    saía do atendimento no meio do registro. Agora o próprio aviso carrega o
    diálogo, e todo lugar que usa este componente ganha o comportamento certo —
    inclusive os que ainda nem existem.
  */
  const [mandando, setMandando] = useState(false);
  const faltando = oQueFaltaNoCadastro(filiado);
  const gravidade = gravidadeDoCadastro(faltando);
  if (gravidade === 'OK') return null;

  const podeLink = podeMandarLink(filiado);

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        gravidade === 'CRITICO'
          ? 'border-amber-300 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/25'
          : 'border-border bg-muted/50',
        className,
      )}
    >
      <p
        className={cn(
          'flex items-start gap-2 text-xs leading-relaxed',
          gravidade === 'CRITICO'
            ? 'text-amber-900 dark:text-amber-200'
            : 'text-muted-foreground',
        )}
      >
        {gravidade === 'CRITICO' ? (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <IdCard className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <span className="min-w-0">
          {compacto ? (
            <>
              {/* "CPF e e-mail", não "CPF, e-mail": é frase, e frase leva "e". */}
              Falta <strong className="font-semibold">{listarEmPortugues(faltando)}</strong> no
              cadastro.
            </>
          ) : (
            fraseDoCadastroIncompleto(faltando)
          )}
        </span>
      </p>

      {/*
        AS DUAS SAÍDAS, LADO A LADO E DO MESMO TAMANHO. Nenhuma das duas é a
        "certa": mandar o link serve para quem está no telefone, preencher na
        hora serve para quem está no balcão. Botões de 44px porque a triagem
        atende de celular.
      */}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {podeLink && (
          <button
            type="button"
            onClick={() => setMandando(true)}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-brand-300 bg-card px-3 text-xs font-medium text-brand-800 transition hover:bg-brand-50 dark:border-brand-900/60 dark:text-brand-300 dark:hover:bg-brand-950/30"
          >
            <Send className="h-3.5 w-3.5" /> Mandar link de recadastro
          </button>
        )}
        <Link
          href={`/filiados/${filiadoId}/recadastrar`}
          className={cn(
            'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border bg-card px-3 text-xs font-medium transition hover:bg-muted',
            !podeLink && 'sm:col-span-2',
          )}
        >
          <UserCog className="h-3.5 w-3.5" /> Preencher aqui, com o {V.filiado}
        </Link>
      </div>

      {!podeLink && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Sem telefone e sem e-mail não há para onde mandar o link — peça os dados agora e preencha
          por aqui.
        </p>
      )}

      <EnviarLinkModal
        filiadoId={filiadoId}
        nome={nome}
        open={mandando}
        onClose={() => setMandando(false)}
      />
    </div>
  );
}

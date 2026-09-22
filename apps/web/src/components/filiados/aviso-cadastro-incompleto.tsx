'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronRight, IdCard, Send, UserCog } from 'lucide-react';
import { EnviarLinkModal } from '@/components/filiados/enviar-link-modal';
import { CadastroFiliadoModal } from '@/components/filiados/cadastro-filiado-modal';
import { cn } from '@/lib/utils';
import { V } from '@/lib/vocabulario';
import {
  gravidadeDoCadastro,
  listarEmPortugues,
  oQueFaltaNoCadastro,
  porQueFazFalta,
  type CadastroDoFiliado,
} from '@/lib/cadastro-incompleto';

/**
 * O AVISO QUE COBRA O RECADASTRAMENTO NA HORA DO ATENDIMENTO — 21/09/2026.
 *
 * "Temos que ser mais incisivos com isso para que a triagem sempre seja
 * induzida a pedir o filiado para se recadastrar."
 *
 * INCISIVO É TER SAÍDA, não ser vermelho. A regra da casa para faixa vale aqui:
 * consequência na frente, as alavancas à vista, e tom proporcional ao dano.
 * Âmbar, nunca vermelho — vermelho é do Excluir; cadastro furado pede alguém,
 * não anuncia estrago.
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
  /** Na gaveta do atendimento o espaço é menor: encurta a explicação. */
  compacto?: boolean;
  className?: string;
}) {
  /*
    O LINK ABRE EM MODAL, e não numa outra tela (21/09/2026).

    "Quando clico em mandar link de recadastro, não gera link nenhum, na verdade
    vai pra tela do filiado detalhado." Era um `Link` para a ficha: quem clicava
    saía do atendimento no meio do registro. Agora o próprio aviso carrega o
    diálogo, e todo lugar que usa este componente ganha o comportamento certo.
  */
  const [mandando, setMandando] = useState(false);
  /*
    O PRESENCIAL TAMBÉM É MODAL — e é o MESMO formulário do cadastro (22/09/2026).

    "Preencher aqui com filiado e atualização cadastral ficou redundante.
    Basicamente é para ser um modal de recadastramento, completo, mesmo que
    fique multi step se necessário."

    `CadastroFiliadoModal` com `filiadoId` já fazia exatamente isto: carrega a
    ficha, roda o `FiliadoForm` em `modo="recadastrar"` e `emPassos`, e respeita
    os campos travados. Não escrevi tela nova — só parei de duplicar a que havia.
  */
  const [recadastrando, setRecadastrando] = useState(false);
  const faltando = oQueFaltaNoCadastro(filiado);
  const gravidade = gravidadeDoCadastro(faltando);

  const modais = (
    <>
      <EnviarLinkModal
        filiadoId={filiadoId}
        nome={nome}
        open={mandando}
        onClose={() => setMandando(false)}
      />
      <CadastroFiliadoModal
        open={recadastrando}
        filiadoId={filiadoId}
        onClose={() => setRecadastrando(false)}
        onSalvo={() => setRecadastrando(false)}
      />
    </>
  );

  /*
    CADASTRO EM ORDEM NÃO GANHA AVISO — mas as PORTAS não somem junto.

    A pessoa mudou de endereço, trocou de telefone, e nada disso "falta". Ficam
    duas linhas discretas, sem cor e sem moldura: não pedem nada, só existem
    para quando alguém precisar.
  */
  if (gravidade === 'OK') {
    return (
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
        <BotaoDiscreto onClick={() => setRecadastrando(true)} icone={UserCog}>
          Atualizar cadastro
        </BotaoDiscreto>
        <BotaoDiscreto onClick={() => setMandando(true)} icone={Send}>
          Mandar link de recadastro
        </BotaoDiscreto>
        {modais}
      </div>
    );
  }

  const critico = gravidade === 'CRITICO';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border',
        critico
          ? 'border-amber-300 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/25'
          : 'border-border bg-muted/40',
        className,
      )}
    >
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        {critico ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        ) : (
          <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          {/*
            A FRASE DIZ O QUE FALTA, COM NOME. "Cadastro desatualizado" não diz
            o que fazer; "Falta CPF e telefone" diz. E a lista sai com "e", que
            é como se fala — vírgula até o fim é lista de sistema.
          */}
          <p
            className={cn(
              'text-[13px] font-semibold leading-snug',
              critico ? 'text-amber-900 dark:text-amber-100' : 'text-foreground',
            )}
          >
            Este {V.filiado} tem poucos dados no cadastro.
          </p>
          <p
            className={cn(
              'mt-0.5 text-xs leading-relaxed',
              critico ? 'text-amber-900/80 dark:text-amber-200/80' : 'text-muted-foreground',
            )}
          >
            Falta <strong className="font-semibold">{listarEmPortugues(faltando)}</strong>
            {compacto ? '.' : ` — ${porQueFazFalta(faltando)}`}
          </p>
        </div>
      </div>

      {/*
        AS DUAS SAÍDAS, EXPLICADAS — 22/09/2026.

        "Queria botar um botão a mais tipo: 'Quer que o filiado se recadastre
        sozinho? Mande o link para ele. Clique aqui e copie a mensagem e envie
        no whatsapp do filiado'."

        Eram dois botões de uma linha, e a diferença entre eles não estava
        escrita em lugar nenhum — quem nunca usou não sabia que o link manda a
        pessoa preencher do próprio celular. Agora cada saída diz o que faz e
        para quem serve, em uma linha. Continuam do mesmo tamanho: nenhuma das
        duas é a "certa". Mandar o link serve para quem está no telefone (e o
        canal desta lista é WhatsApp na esmagadora maioria); preencher na hora
        serve para quem está no balcão.

        O BOTÃO DO LINK NÃO SOME MAIS QUANDO FALTA TELEFONE, e esse era um
        defeito meu. A regra antiga (`podeMandarLink`) escondia a saída inteira
        quando o cadastro não tinha celular nem e-mail, com o texto "não há para
        onde mandar o link". É falso: o modal oferece **Copiar mensagem** e
        **Copiar só o link** justamente para o caso de a triagem já estar na
        conversa do WhatsApp — que é exatamente a situação em que o telefone
        falta no cadastro e está na tela de quem atende. Eu escondia a saída
        mais útil no momento em que ela mais servia. Quando o link de fato não
        puder ser gerado (ficha sem CPF, sem nascimento e sem COREN), quem diz
        isso é o próprio modal, com o motivo — e não este aviso, por adivinhação.
      */}
      {/*
        UMA EMBAIXO DA OUTRA, SEMPRE — e o motivo é medido, não estético.

        Eram duas colunas em `sm:`, e o breakpoint mede a JANELA, não a caixa.
        Só que este aviso nunca vive numa caixa larga: os dois lugares que o
        usam hoje são a gaveta do atendimento (512px) e o modal de novo
        atendimento (`max-w-md`, 448px). Nos dois, numa tela de 1440, o `sm:`
        entrava assim mesmo e cada saída ficava com ~230px — "Mandar o link
        para o filiado" quebrava no meio do nome e a explicação virava quatro
        linhas. É o mesmo erro que espremeu o formulário, um andar acima.

        Poderia ser uma condicional de quem chama. Não é: condicional guardaria
        uma coluna dupla que nenhum chamador tem largura para usar, e um dia
        alguém a ligaria de novo sem medir. Empilhado lê melhor de qualquer
        forma — linha inteira, título numa linha, explicação em duas.
      */}
      <div className="mt-3 grid gap-px bg-border/70">
        <Saida
          icone={Send}
          titulo={`Mandar o link para o ${V.filiado}`}
          detalhe="Copie a mensagem pronta e cole no WhatsApp dele — ele preenche do próprio celular."
          onClick={() => setMandando(true)}
          destaque
        />
        <Saida
          icone={UserCog}
          titulo="Preencher aqui, agora"
          detalhe={`Com o ${V.filiado} na frente ou na linha. O cadastro inteiro, em quatro etapas.`}
          onClick={() => setRecadastrando(true)}
        />
      </div>

      {modais}
    </div>
  );
}

/**
 * Uma saída do aviso: título, uma linha de explicação e a seta.
 *
 * Linha inteira clicável, com 44px de altura mínima — a triagem atende de
 * celular, e alvo pequeno em tela de toque é erro de clique, não de pessoa.
 */
function Saida({
  icone: Icone,
  titulo,
  detalhe,
  onClick,
  destaque,
}: {
  icone: typeof Send;
  titulo: string;
  detalhe: string;
  onClick: () => void;
  /** O primeiro caminho ganha o ícone em cor; não ganha peso nem tamanho. */
  destaque?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-11 w-full items-center gap-2.5 bg-card px-3.5 py-2.5 text-left transition hover:bg-muted/60"
    >
      <Icone
        className={cn(
          'h-4 w-4 shrink-0 transition',
          destaque ? 'text-brand-700 dark:text-brand-300' : 'text-muted-foreground',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold leading-tight">{titulo}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
          {detalhe}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </button>
  );
}

/** A porta sem aviso: existe, não chama atenção. */
function BotaoDiscreto({
  onClick,
  icone: Icone,
  children,
}: {
  onClick: () => void;
  icone: typeof Send;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
    >
      <Icone className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Radar, ChevronRight, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import { tenant } from '@/tenant.config';
import {
  listarSugestoesDeProcesso,
  formatNPU,
  type SugestaoDeProcesso,
} from '@/lib/processos';

/**
 * AS AÇÕES QUE O DIÁRIO REVELOU E NINGUÉM CADASTROU — no painel, não na testa.
 *
 * POR QUE AQUI, E POR QUE ISTO NÃO É A FAIXA DE VOLTA
 * A faixa global mostrava este mesmo número em cima de TODA tela do sistema, e
 * o usuário reclamou com razão: são trinta itens que levam dias para conferir,
 * então ela virava cabeçalho — e cabeçalho ninguém lê. Um card no painel
 * aparece UMA vez, no lugar onde a pessoa vai ver o dia dela, e não persegue
 * ninguém até Cobranças.
 *
 * POR QUE SAIU DE `minhas-pendencias` PARA A FILA DE VERDADE
 * A primeira versão reusava a consulta do sino para não gastar requisição. Só
 * que o sino carrega o mínimo — número e rótulo — e a linha resultante era
 * "Movemos · 08053442320218180031": vinte dígitos e uma palavra. Para saber
 * CONTRA QUEM é a ação, ou de quem ela seria, era preciso abrir.
 *
 * A fila (`/processos/sugestoes`) já devolve as partes, o polo e os nossos
 * advogados COM FOTO — e é a mesma chave de cache da tela de Processos, então
 * quem for para lá em seguida não paga de novo. Economizar uma requisição para
 * mostrar um número de vinte dígitos é economia no lugar errado.
 *
 * NÃO É VERMELHO, e é decisão. Vermelho é para o que já venceu. Isto é trabalho
 * a fazer, e o que dá urgência a uma ação recente agora é outra coisa: ela vira
 * TAREFA na agenda do advogado citado no ato.
 */
const QUANTAS = 3;

const POLO_CHIP: Record<SugestaoDeProcesso['nossoPolo'], { texto: string; cls: string }> = {
  ATIVO: {
    texto: 'Movemos',
    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  PASSIVO: {
    texto: 'Contra nós',
    cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  },
  AMBOS: {
    texto: 'Dois polos',
    cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  },
  INDEFINIDO: {
    texto: 'Polo indefinido',
    cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

/** Nome de tribunal vem em CAIXA ALTA; ler linha após linha assim cansa. */
function capitalizar(nome: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return nome
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((p, i) =>
      i > 0 && minusculas.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1),
    )
    .join(' ');
}

/** Espelha `lib/sigla-do-sindicato`: pontuação vira ESPAÇO, nunca some. */
function palavras(nome: string): string[] {
  return (nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * QUEM ESTÁ DO OUTRO LADO — a única pergunta que a linha precisa responder.
 *
 * Mostrar "Autor × Réu" gastaria a linha inteira repetindo o nome do sindicato,
 * que é o mesmo nas trinta. O que muda de uma para outra é o ADVERSÁRIO, e é
 * ele que decide se alguém abre.
 */
function adversario(s: SugestaoDeProcesso): string | null {
  const nosso = palavras(tenant.sigla).join('');
  const oPoloDeles = s.nossoPolo === 'PASSIVO' ? 'A' : 'P';
  const nomes = (s.partes ?? [])
    .filter((p) => (p.polo ?? '').trim().toUpperCase().startsWith(oPoloDeles))
    .map((p) => (p.nome ?? '').trim())
    .filter(Boolean)
    // O sindicato aparece nos dois polos em recurso: nunca é o adversário.
    .filter((n) => nosso.length < 4 || !palavras(n).includes(nosso));
  if (!nomes.length) return null;
  return capitalizar(nomes[0]) + (nomes.length > 1 ? ` +${nomes.length - 1}` : '');
}

/**
 * O QUE DIZER QUANDO NÃO HÁ ADVERSÁRIO NO ATO.
 *
 * Rodando contra a produção: 23 das 30 sugestões rendem um nome; nas outras 7 a
 * publicação listou só o NOSSO lado — não é falha de leitura, é o que o tribunal
 * mandou. "Parte não informada" seria tecnicamente correto e inútil.
 *
 * Mas essas 7 trazem a CLASSE, e ela informa muito: "Cumprimento de Sentença
 * contra a Fazenda Pública" diz o que é a ação e em que fase está — mais do que
 * o nome de um município diria. Depois dela vem o órgão, que ao menos localiza.
 */
function descreverAcao(s: SugestaoDeProcesso): { texto: string; forte: boolean } {
  const contra = adversario(s);
  if (contra) return { texto: contra, forte: true };
  const classe = (s.nomeClasse ?? '').trim();
  if (classe) return { texto: capitalizar(classe), forte: false };
  const orgao = (s.nomeOrgao ?? '').trim();
  if (orgao) return { texto: orgao, forte: false };
  return { texto: 'Parte não informada no ato', forte: false };
}

/** Há quanto tempo espera — em dias, que é a unidade da decisão. */
function esperaEmDias(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function AcoesSemCadastro() {
  const { user } = useAuth();
  /*
    QUEM CADASTRA, e não quem apenas vê. A rota é `@Modulo('processos')` e o
    card só oferece um botão: "Cadastrar". Desenhá-lo para quem levaria 403 ao
    clicar é oferecer um caminho que não existe.
  */
  const permitido = podeEditar(user?.role, user?.permissoes, 'processos');

  const { data } = useQuery({
    queryKey: ['processos', 'sugestoes'],
    queryFn: listarSugestoesDeProcesso,
    enabled: permitido,
    staleTime: 30_000,
    retry: false,
  });

  const fila = data ?? [];
  if (!permitido || !fila.length) return null;

  const mostradas = fila.slice(0, QUANTAS);
  const sobra = fila.length - mostradas.length;

  return (
    <Card className="overflow-hidden border-indigo-200 dark:border-indigo-900/50">
      <div className="flex items-start gap-3 border-b border-indigo-100 bg-indigo-50/60 px-4 py-3 dark:border-indigo-900/40 dark:bg-indigo-950/20">
        <Radar className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700 dark:text-indigo-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {fila.length === 1
              ? `1 ação do ${tenant.sigla} apareceu no Diário`
              : `${fila.length} ações do ${tenant.sigla} apareceram no Diário`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ainda não estão no acervo. As recentes já viraram tarefa na agenda do
            advogado citado no ato; as demais esperam aqui, sem prazo.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-indigo-100 dark:divide-indigo-900/30">
        {mostradas.map((s) => {
          const chip = POLO_CHIP[s.nossoPolo];
          const oQueE = descreverAcao(s);
          const dias = esperaEmDias(s.primeiraEm);
          const nossos = s.advogadosNossos ?? [];
          return (
            <li key={s.id}>
              <Link
                href={`/processos?cadastrar=${s.numeroCNJ}`}
                className="flex flex-col gap-1 px-4 py-2.5 transition hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-3"
              >
                {/*
                  LINHA 1 NO CELULAR, PRIMEIRA COLUNA NO DESKTOP.

                  Polo e adversário juntos formam a frase que se lê de relance —
                  "contra nós, a Hapvida". O NPU desce para a segunda linha
                  porque é o que menos se lê e o que mais ocupa: vinte dígitos.
                */}
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      chip.cls,
                    )}
                  >
                    {chip.texto}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      // Nome de adversário é o dado; classe é o consolo. A cor
                      // diz qual dos dois a linha conseguiu mostrar, sem
                      // precisar de uma segunda frase explicando.
                      oQueE.forte ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    title={oQueE.texto}
                  >
                    {oQueE.texto}
                  </span>
                </span>

                <span className="flex items-center gap-2 pl-1 sm:shrink-0 sm:pl-0">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground sm:flex-none">
                    {formatNPU(s.numeroCNJ) || s.numeroCNJ}
                  </span>
                  {/*
                    O ROSTO DE QUEM FOI CITADO NO ATO.

                    Não é palpite nem sugestão: a ação chegou à fila PORQUE a OAB
                    dele estava na publicação. Numa fila coletiva de trinta, é o
                    rosto que responde "esta é minha" sem abrir nada.
                  */}
                  {nossos.length > 0 && (
                    <span className="flex -space-x-1.5">
                      {nossos.slice(0, 2).map((a) => (
                        <AvatarPessoa
                          key={a.id}
                          nome={a.nomeExibicao || a.nome}
                          url={a.avatarUrl}
                          titulo={`${a.nome} — citado neste ato`}
                          tamanho="xs"
                          className="ring-2 ring-card"
                        />
                      ))}
                      {nossos.length > 2 && (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[9px] font-semibold ring-2 ring-card">
                          +{nossos.length - 2}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {dias === 0 ? 'hoje' : `há ${dias}d`}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-brand-800 dark:text-brand-300">
                    Cadastrar
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/*
        O LINK LEVA À FILA ABERTA — `?fila=acoes`.

        Antes ia para `/processos` puro e a seção chegava recolhida: quem
        clicou em "ver as outras 22" tinha de procurar o cabeçalho e clicar de
        novo. Só este link abre; chegar por outro caminho mantém o padrão
        recolhido.
      */}
      <Link
        href={sobra > 0 ? '/processos?fila=acoes' : '/processos'}
        className="flex items-center justify-between gap-2 border-t border-indigo-100 px-4 py-2.5 text-xs font-medium text-brand-800 transition hover:bg-muted/60 dark:border-indigo-900/30 dark:text-brand-300"
      >
        {sobra > 0 ? `Ver as outras ${sobra} na fila` : 'Abrir a fila em Processos'}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </Card>
  );
}

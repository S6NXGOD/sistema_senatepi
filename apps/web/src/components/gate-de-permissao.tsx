'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ShieldOff, ArrowLeft } from 'lucide-react';
import { moduloDaRota } from '@/components/nav-items';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo } from '@/lib/permissoes';
import { Button } from '@/components/ui/button';

/**
 * A PERMISSÃO PASSA A VALER PELA ROTA, E NÃO BOTÃO POR BOTÃO.
 *
 * O PROBLEMA, RELATADO DUAS VEZES. Um advogado com "Colaboradores: só
 * visualizar" abria a ficha de um colaborador e via o botão Editar. Eu tinha
 * escondido o lápis NA LISTAGEM e não na ficha — e essa é exatamente a forma
 * errada de resolver: enquanto o gate for por botão, cada tela nova precisa
 * lembrar, e a próxima vai esquecer de novo. Já esqueceu em `colaboradores/[id]`,
 * `filiados/[id]`, `usuarios`, `configuracoes`.
 *
 * Aqui a regra é da ROTA, e vale para toda tela existente e futura:
 *
 *   · sem VISUALIZAR no módulo da rota  -> a tela não abre;
 *   · rota de EDIÇÃO sem EDITAR         -> a tela não abre.
 *
 * COMO SE SABE QUE UMA ROTA É DE EDIÇÃO. Pelo último segmento do caminho:
 * `/novo`, `/nova`, `/editar`, `/importar`. É convenção, e convenção falha em
 * silêncio — por isso ela é só a SEGUNDA linha de defesa. A primeira é a API,
 * que desde 21/08 exige EDITAR em todo POST/PATCH via `@Modulo`, e essa não
 * depende de ninguém lembrar de nomear a pasta direito.
 *
 * FRONT NÃO PROTEGE NADA, e este componente não muda isso. Ele existe para a
 * pessoa saber ANTES — em vez de preencher um formulário inteiro e levar 403 no
 * fim, ou de ver um botão que não funciona e concluir que o sistema está
 * quebrado.
 *
 * O ADMINISTRADOR passa sempre, como no `PermissionsGuard` da API.
 */

/** Último segmento que denuncia uma tela de escrita. */
const SEGMENTOS_DE_EDICAO = new Set(['novo', 'nova', 'editar', 'importar']);

export function ehRotaDeEdicao(pathname: string): boolean {
  const partes = pathname.split('?')[0].split('/').filter(Boolean);
  return partes.some((p) => SEGMENTOS_DE_EDICAO.has(p.toLowerCase()));
}

export function GateDePermissao({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { user, carregando } = useAuth();
  const modulo = moduloDaRota(pathname);

  // Sem módulo mapeado (ex.: /meu-perfil) não há o que exigir. E enquanto a
  // sessão carrega, mostrar "sem permissão" seria mentir por meio segundo.
  if (!modulo || carregando || !user) return <>{children}</>;

  const nivel = nivelEfetivo(user.role, user.permissoes, modulo);

  if (nivel === 'SEM_ACESSO') {
    return (
      <SemPermissao
        titulo="Você não tem acesso a esta área"
        detalhe="Seu perfil não inclui este módulo. Se precisar dele para trabalhar, peça ao administrador."
      />
    );
  }

  if (nivel === 'VISUALIZAR' && ehRotaDeEdicao(pathname)) {
    return (
      <SemPermissao
        titulo="Você pode consultar, mas não alterar"
        detalhe="Seu perfil dá acesso de leitura a este módulo. A criação e a edição estão com o administrador."
      />
    );
  }

  return <>{children}</>;
}

/**
 * A cara do "você não pode".
 *
 * NÃO redireciona, e é decisão. Jogar a pessoa para o painel a deixaria sem
 * saber se errou o endereço, se o item sumiu ou se falta permissão — e ela
 * tentaria de novo. Dizer o motivo encerra a dúvida e transforma o próximo
 * passo em pedir acesso, não em insistir.
 */
function SemPermissao({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <ShieldOff className="h-7 w-7 text-muted-foreground" />
      </span>
      <h1 className="mt-4 text-xl font-semibold">{titulo}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{detalhe}</p>
      <Link href="/dashboard" className="mt-5">
        <Button variant="outline">
          <ArrowLeft className="h-4 w-4" /> Voltar ao painel
        </Button>
      </Link>
    </div>
  );
}

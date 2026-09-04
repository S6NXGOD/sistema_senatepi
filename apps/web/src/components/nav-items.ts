import {
  LayoutDashboard, Users, Contact, CalendarDays, Umbrella, ScanLine,
  ShieldCheck, Receipt, Headset, CalendarClock, Gavel, UserCog, CalendarRange,
  Building2, Landmark, type LucideIcon,
} from 'lucide-react';
import { podeVer, type ModuloKey } from '@/lib/permissoes';
import { moduloAtivo } from '@/tenant.config';
import { V } from '@/lib/vocabulario';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Módulo permissionável — usado para ocultar o item de quem não tem acesso. */
  modulo?: ModuloKey;
}

export interface NavSecao {
  titulo: string;
  itens: NavItem[];
}

/**
 * Navegação do administrativo, agrupada por área (compartilhada entre a Sidebar
 * e o menu mobile). Cada item declara seu `modulo` para o gating por permissão.
 */
export const NAV_SECOES: NavSecao[] = [
  {
    titulo: 'Início',
    itens: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, modulo: 'dashboard' },
    ],
  },
  {
    // Fluxo jurídico, na ordem em que a demanda caminha: entra na triagem,
    // vira processo, gera prazos na agenda e é coberta pela escala de plantão.
    titulo: 'Jurídico',
    itens: [
      { href: '/atendimentos', label: 'Atendimentos', icon: Headset, modulo: 'atendimentos' },
      { href: '/processos', label: 'Processos', icon: Gavel, modulo: 'processos' },
      { href: '/agenda', label: 'Agenda e Prazos', icon: CalendarClock, modulo: 'agenda' },
      { href: '/escalas', label: 'Escalas dos Advogados', icon: CalendarRange, modulo: 'escalas' },
      // Fica no Jurídico porque serve aos dois papéis: o órgão que emprega o
      // filiado é o mesmo que figura como réu na ação dele.
      //
      // ESTE É **O** CADASTRO DE ORGANIZAÇÃO — órgão público, empresa e pessoa
      // física. "Empresas", no menu Patronal, NÃO é um segundo cadastro: é o
      // trabalho patronal (portal e contribuições) sobre as organizações que
      // contribuem, penduradas nestas por `empresas.parte_externa_id`.
      //
      // ÍCONE DIFERENTE de propósito. Os dois itens usavam `Building2`, e ícone
      // igual com nome sinônimo foi metade do motivo pelo qual as telas eram
      // lidas como a mesma coisa. `Landmark` (instituição) para o cadastro,
      // `Building2` (prédio) para o patronal.
      //
      // MÓDULO PRÓPRIO, e não `processos`, porque um cliente pode não ter esta
      // tela. Isto gateia a TELA, não o dado: `/partes-externas` continua em
      // `@Modulo('processos')` na API, porque é ele que alimenta o seletor de
      // partes e o combobox de empregador em TODO cliente.
      { href: '/organizacoes', label: 'Organizações', icon: Landmark, modulo: 'organizacoes' },
    ],
  },
  {
    titulo: 'Pessoas',
    itens: [
      // A ROTA continua `/filiados` em qualquer cliente: URL é identificador,
      // não texto. Só o rótulo muda.
      { href: '/filiados', label: V.Filiados, icon: Users, modulo: 'filiados' },
      { href: '/colaboradores', label: 'Colaboradores', icon: Contact, modulo: 'colaboradores' },
    ],
  },
  {
    /**
     * PATRONAL E FINANCEIRO NUMA SEÇÃO SÓ.
     *
     * Eram duas seções de UM item cada — dois títulos ocupando mais altura
     * que o conteúdo que anunciavam. Contribuição de empresa e cobrança de
     * filiado são o mesmo assunto para quem usa: dinheiro que entra.
     */
    titulo: 'Financeiro',
    itens: [
      // NÃO é um segundo cadastro de organização — é o trabalho PATRONAL
      // (acesso ao portal e contribuições) sobre as que contribuem. A
      // identidade delas (razão social, CNPJ) mora em Organizações e é lá que
      // se corrige; aqui ela só é EXIBIDA, lida de lá.
      { href: '/empresas', label: 'Empresas contribuintes', icon: Building2, modulo: 'empresas' },
      { href: '/cobrancas', label: 'Cobranças', icon: Receipt, modulo: 'cobrancas' },
    ],
  },
  {
    titulo: 'Serviços',
    itens: [
      { href: '/eventos', label: 'Eventos', icon: CalendarDays, modulo: 'eventos' },
      { href: '/colonia-admin', label: 'Colônia de Férias', icon: Umbrella, modulo: 'colonia' },
      { href: '/portaria', label: 'Portaria / Clube', icon: ScanLine, modulo: 'acessos' },
    ],
  },
  {
    titulo: 'Administração',
    itens: [
      { href: '/usuarios', label: 'Usuários e Perfis', icon: UserCog, modulo: 'usuarios' },
      // "Cadastros Base" saiu daqui: cargos e departamentos são listas de apoio
      // de Colaboradores e agora se editam de dentro daquela tela.
      { href: '/auditoria', label: 'Auditoria', icon: ShieldCheck, modulo: 'auditoria' },
    ],
  },
];

/** Lista plana (compatibilidade). */
export const NAV_ITENS: NavItem[] = NAV_SECOES.flatMap((s) => s.itens);

/**
 * Rotas que pertencem a um módulo mas não têm item de menu próprio.
 *
 * Sem isto, `/colonia-admin/123` e `/colonia/inscricao` continuariam abrindo
 * numa instalação sem colônia — o menu escondido não protege quem digita a URL.
 */
const ROTAS_EXTRAS: Array<{ prefixo: string; modulo: ModuloKey }> = [
  // Vistas do acervo: viraram abas dentro de Processos e saíram do menu, mas
  // as rotas continuam — link salvo, atalho da home, link colado no WhatsApp.
  // Sem estas linhas elas ficariam sem gate de permissão.
  { prefixo: '/publicacoes', modulo: 'processos' },
  { prefixo: '/panorama', modulo: 'processos' },
  { prefixo: '/colonia', modulo: 'colonia' },      // inscrição pública
  { prefixo: '/carteirinhas', modulo: 'filiados' },
  { prefixo: '/validacao', modulo: 'eventos' },    // validação de presença em evento
  { prefixo: '/evento', modulo: 'eventos' },       // página pública do evento
];

/**
 * A qual módulo esta rota pertence — ou `null` se ela não é de módulo nenhum
 * (login, configurações do próprio usuário, portal da empresa).
 *
 * Derivado do MESMO `NAV_SECOES` que monta o menu, de propósito. Uma segunda
 * tabela de rota→módulo divergiria na primeira vez que alguém acrescentasse um
 * item em só um dos lados, e o sintoma seria o pior possível: menu escondido
 * com a tela ainda acessível.
 *
 * Vence o prefixo MAIS LONGO: `/colonia-admin` precisa ganhar de `/colonia`,
 * senão a tela administrativa cairia na regra da página pública.
 */
export function moduloDaRota(pathname: string): ModuloKey | null {
  const candidatos = [
    ...NAV_ITENS.filter((i) => i.modulo).map((i) => ({ prefixo: i.href, modulo: i.modulo! })),
    ...ROTAS_EXTRAS,
  ]
    .filter(({ prefixo }) => pathname === prefixo || pathname.startsWith(`${prefixo}/`))
    .sort((a, b) => b.prefixo.length - a.prefixo.length);

  return candidatos[0]?.modulo ?? null;
}

/** Filtra as seções/itens de navegação segundo as permissões do usuário. */
export function filtrarNav(
  role: string | null | undefined,
  permissoes: unknown,
): NavSecao[] {
  return NAV_SECOES
    .map((secao) => ({
      ...secao,
      /**
       * DOIS filtros, e a ordem importa pouco mas o significado é diferente:
       * `moduloAtivo` pergunta se a INSTALAÇÃO tem o módulo; `podeVer`, se a
       * PESSOA pode. Um módulo que o sindicato não contratou some para todo
       * mundo, inclusive para o administrador.
       */
      itens: secao.itens.filter(
        (i) => !i.modulo || (moduloAtivo(i.modulo) && podeVer(role, permissoes, i.modulo)),
      ),
    }))
    .filter((secao) => secao.itens.length > 0);
}

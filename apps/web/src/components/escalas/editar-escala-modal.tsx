'use client';

import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeftRight, CalendarClock, Check, Info, Loader2, Pencil, X } from 'lucide-react';
import { useDialogo } from './use-dialogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import { useAuth } from '@/lib/auth';
import { podeEditar as podeEditarModulo, podeVer } from '@/lib/permissoes';
import { formatDataPura } from '@/lib/data-pura';
import { linkWhatsApp } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';
import { SeletorDePessoa } from './seletor-de-pessoa';
import {
  AdvogadoEscala, AlteracaoDeEscala, ConsultaDoPlantao, ConsultasDoPlantao, Escala, ResultadoDasConsultas,
  apoioDaConsulta, atualizarEscala, avisoDaConsultaPassada, avisoDoEncurtamento, cabecalhoDasConsultas, celularDaConsultaPassada, comArtigo,
  comMaiuscula, consultasQueQuemEntraAssume, daPessoa, diaCurto, faixaDaPreviaDoHorario, faixaDoPlantao, fraseDoChoque, frasesDasIgnoradas,
  horaBR, listarConsultasDoPlantao, marcadaPorPadrao, mensagemDaTrocaDeAdvogado, mensagemDoErro, nomeDeExibicao,
  planejarAlteracao, planejarPassagem, resumoDaTroca, rotuloDasForaDoHorario, sobreposicaoQueVale, textoDoPlantaoPassado,
} from '@/lib/escalas';

export type ModoDaEdicao = 'editar' | 'trocar';

/**
 * CORRIGIR OU TROCAR um plantão (PATCH /escalas/:id).
 *
 * "Trocar com…" é só mudar a pessoa: com cinco advogados, a troca se combina no
 * corredor e alguém registra. A data não muda aqui — plantão em outro dia é
 * outro plantão.
 *
 * AS CONSULTAS DE QUEM SAI (D16, 14/09/2026). Trocar a pessoa deixava as
 * consultas marcadas com quem saiu: o filiado chegava esperando a Dra. X e o
 * Dr. Y não via nada. Não existe ligação consulta↔plantão, então o servidor
 * INFERE quais são e a tela pede a decisão: marcada passa, desmarcada fica.
 * Cancelar não existe aqui — deixaria o atendimento sem saída; quem não pode
 * atender remarca pela agenda.
 */
export function EditarEscalaModal({
  alvo,
  pessoas,
  carregandoPessoas = false,
  onClose,
  onSalvo,
}: {
  alvo: { escala: Escala; modo: ModoDaEdicao } | null;
  pessoas: AdvogadoEscala[];
  carregandoPessoas?: boolean;
  onClose: () => void;
  onSalvo: () => void;
}) {
  if (!alvo) return null;
  return (
    <FormularioDaEdicao
      key={`${alvo.escala.id}-${alvo.modo}`}
      escala={alvo.escala}
      modo={alvo.modo}
      pessoas={pessoas}
      carregandoPessoas={carregandoPessoas}
      onClose={onClose}
      onSalvo={onSalvo}
    />
  );
}

interface PlantaoPassado {
  entra: string;
  resultado: ResultadoDasConsultas;
  /** A prévia no momento de salvar: dá o título das consultas sem filiado. */
  consultas: Map<string, ConsultaDoPlantao>;
}

/** O tempo parado antes de pedir a prévia do horário novo. */
const ATRASO_DA_PREVIA_MS = 300;

/** O valor, só depois de ficar `ms` sem mudar: a prévia não vai à API a cada tecla. */
function useComAtraso<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

function FormularioDaEdicao({
  escala, modo, pessoas, carregandoPessoas, onClose, onSalvo,
}: {
  escala: Escala;
  modo: ModoDaEdicao;
  pessoas: AdvogadoEscala[];
  carregandoPessoas: boolean;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const trocar = modo === 'trocar';
  const pessoaAtualId = escala.advogadoId ?? escala.advogado.id;
  const [advogadoId, setAdvogadoId] = useState(trocar ? '' : pessoaAtualId);
  const [horaInicio, setHoraInicio] = useState(escala.horaInicio);
  const [horaFim, setHoraFim] = useState(escala.horaFim);
  const [observacao, setObservacao] = useState(escala.observacao ?? '');
  const [erro, setErro] = useState<string | null>(null);
  // A escolha vale para a pessoa escolhida: trocar quem assume zera as caixas.
  const [escolhas, setEscolhas] = useState<{ para: string; marcas: Record<string, boolean> }>({ para: '', marcas: {} });
  const [passado, setPassado] = useState<PlantaoPassado | null>(null);

  // Passar consulta é escrever na Agenda: a tela esconde a caixa de quem a API
  // recusaria (403), mesmo que a prévia diga `podePassar`.
  const editaAgenda = podeEditarModulo(user?.role, user?.permissoes, 'agenda');
  const veTelefone = podeVer(user?.role, user?.permissoes, 'filiados');

  // Quem está no plantão pode ter sido desativado depois: continua no seletor
  // da edição, senão o campo apareceria vazio.
  const lista = pessoas.some((p) => p.id === escala.advogado.id) ? pessoas : [...pessoas, escala.advogado];

  const mudaPessoa = !!advogadoId && advogadoId !== pessoaAtualId;
  const horarioValido = !!horaInicio && !!horaFim && horaFim > horaInicio;
  // O horário que a pessoa está digitando, e o que vai à API depois de 300 ms
  // parado: um campo de hora muda a cada segmento, e cada mudança seria uma GET.
  const faixaDigitada = mudaPessoa ? null : faixaDaPreviaDoHorario(escala, { horaInicio, horaFim });
  const [inicioPedido, fimPedido] = useComAtraso(`${horaInicio}|${horaFim}`, ATRASO_DA_PREVIA_MS).split('|');
  const faixaPedida = mudaPessoa ? null : faixaDaPreviaDoHorario(escala, { horaInicio: inicioPedido, horaFim: fimPedido });

  const consultasQ = useQuery({
    queryKey: ['escalas', 'consultas', escala.id, advogadoId],
    queryFn: () => listarConsultasDoPlantao(escala.id, advogadoId),
    enabled: mudaPessoa && !passado,
    retry: 1,
    // Com os 30 s globais, uma consulta marcada nesse meio-tempo passava sem
    // ninguém ter visto e ia para `consultasMantidas` na auditoria (15/09/2026).
    staleTime: 0,
  });
  /*
    MUDAR O HORÁRIO (D17; o horário vai na GET desde 15/09/2026). Antes a GET ia
    sem horário e a conta era daqui, só com a lista: quem não vê a Agenda recebia
    um "alguma pode ficar fora". Agora o servidor conta pelo horário do
    formulário — a mesma conta que a auditoria carimba — e o número vale para
    todos. Só avisa, não trava o salvar. Enquanto a próxima resposta não chega, a
    anterior fica na tela (`keepPreviousData`): o aviso não pisca a cada tecla.
  */
  const doHorarioQ = useQuery({
    queryKey: ['escalas', 'consultas', escala.id, '', faixaPedida?.horaInicio ?? '', faixaPedida?.horaFim ?? ''],
    queryFn: () => listarConsultasDoPlantao(escala.id, undefined, faixaPedida),
    enabled: !!faixaPedida && !passado,
    retry: 1,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  const previa = mudaPessoa ? consultasQ.data : undefined;
  const marcas = escolhas.para === advogadoId ? escolhas.marcas : {};
  const passar = mudaPessoa ? planejarPassagem(previa, marcas, editaAgenda) : undefined;
  const entraPessoa = lista.find((p) => p.id === advogadoId);
  const nomeEntra = previa?.entra ? nomeDeExibicao(previa.entra) : entraPessoa ? nomeDeExibicao(entraPessoa) : '';
  const nomeSai = nomeDeExibicao(escala.advogado);
  // Horário igual ao do plantão, incompleto ou invertido: nada, na hora, sem
  // esperar a resposta. A frase é do servidor; a faixa digitada só serve à conta
  // local do contêiner antigo.
  const avisoHorario = faixaDigitada && faixaPedida && horarioValido && doHorarioQ.data
    ? avisoDoEncurtamento(doHorarioQ.data, faixaDigitada)
    : null;

  const painelRef = useRef<HTMLDivElement>(null);
  const seletorRef = useRef<HTMLSelectElement>(null);

  const plano = planejarAlteracao(escala, { advogadoId, horaInicio, horaFim, observacao });

  const salvar = useMutation({
    mutationFn: (dados: AlteracaoDeEscala) => atualizarEscala(escala.id, dados),
    onSuccess: (atualizada, dados) => {
      // A prévia sai do cache ANTES do `invalidar` da página: ainda ativa, ela
      // seria refeita com quem acabou de assumir e a API responderia 400 ("Quem
      // assume já é a pessoa deste plantão.") a cada troca salva (15/09/2026).
      qc.removeQueries({ queryKey: ['escalas', 'consultas', escala.id] });
      onSalvo();
      if (!dados.advogadoId) {
        toast.success('Plantão atualizado.');
        return onClose();
      }
      // O plantão do dia aparece no detalhe da atividade; as consultas passadas,
      // na agenda, no painel e na triagem. `minhas-pendencias` entrou em
      // 14/09/2026: a consulta passada sai da lista de quem saiu e entra na de
      // quem assumiu, e a faixa lê essa chave.
      for (const k of [['compromissos'], ['plantao'], ['atendimentos'], ['minhas-pendencias']]) void qc.invalidateQueries({ queryKey: k });
      const quem = atualizada?.advogado ?? lista.find((p) => p.id === dados.advogadoId);
      const nome = quem ? nomeDeExibicao(quem) : nomeEntra;
      const resultado = atualizada?.consultas;
      if (resultado && resultado.passadas.length > 0) {
        const consultas = new Map<string, ConsultaDoPlantao>();
        for (const c of [...(previa?.noHorario ?? []), ...(previa?.foraDoHorario ?? [])]) consultas.set(c.id, c);
        setPassado({ entra: nome, resultado, consultas });
        return;
      }
      const ignoradas = resultado ? frasesDasIgnoradas(resultado.ignoradas) : [];
      toast.success(`${nome || 'A nova pessoa'} assumiu o plantão de ${diaCurto(escala.data)}.`, {
        description: ignoradas.length ? ignoradas.join(' ') : undefined,
      });
      onClose();
    },
    onError: (e) => setErro(mensagemDoErro(e, 'Não foi possível salvar. Tente de novo.')),
  });

  function alternar(id: string, atual: boolean) {
    setErro(null);
    setEscolhas({ para: advogadoId, marcas: { ...marcas, [id]: !atual } });
  }

  function submeter() {
    if (trocar && !advogadoId) return setErro('Escolha quem vai assumir o plantão.');
    if (!horarioValido) {
      return setErro(`Em ${diaCurto(escala.data)}, a hora de fim deve ser depois da de início.`);
    }
    if (!plano) return onClose();
    setErro(null);
    salvar.mutate(passar !== undefined ? { ...plano, passarConsultas: passar } : plano);
  }

  const dia = formatDataPura(escala.data, { weekday: 'long', day: '2-digit', month: '2-digit' });
  const Icone = passado ? Check : trocar ? ArrowLeftRight : Pencil;
  const tituloId = `editar-escala-${escala.id}`;
  // Enquanto a prévia carrega, salvar mandaria a troca sem a decisão sobre as
  // consultas; com erro, libera (e as consultas ficam com quem saiu).
  const esperandoPrevia = mudaPessoa && consultasQ.isLoading;
  const sobreposicao = sobreposicaoQueVale(previa, escala, { horaInicio, horaFim });
  // Na troca o que falta é escolher quem assume: o foco já vai para o seletor.
  useDialogo({ painel: painelRef, focoInicial: trocar ? seletorRef : undefined, ocupado: salvar.isPending, onFechar: onClose });
  const assumidas = consultasQueQuemEntraAssume(previa, passar);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        ref={painelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        // dvh: no celular, 92vh conta a barra do navegador e o rodapé podia
        // ficar atrás dela (15/09/2026).
        className="flex max-h-[92vh] w-full max-w-md animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl outline-none supports-[height:100dvh]:max-h-[92dvh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <Icone className="h-5 w-5 text-brand-800 dark:text-brand-400" />
            </div>
            <div className="min-w-0">
              <h3 id={tituloId} className="text-lg font-bold">
                {passado ? 'Plantão passado' : trocar ? 'Trocar plantão' : 'Editar plantão'}
              </h3>
              <p className="text-sm text-muted-foreground">
                <span className="first-letter:uppercase">{dia}</span> · <span className="tabular-nums">{faixaDoPlantao(escala)}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={salvar.isPending}
            aria-label="Fechar"
            className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {passado ? (
          <>
            <PassoDoPlantaoPassado passado={passado} dia={escala.data} veTelefone={veTelefone} />
            <div className="flex gap-2 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end">
              <Button className="flex-1 sm:flex-none" onClick={onClose}>Fechar</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {trocar ? (
                <>
                  <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                    Hoje o plantão está com <strong className="font-semibold">{nomeSai}</strong>.
                  </p>
                  <div className="space-y-1.5">
                    <label htmlFor="troca-pessoa" className="text-sm font-medium">Quem assume o plantão *</label>
                    <SeletorDePessoa
                      selectRef={seletorRef}
                      id="troca-pessoa"
                      value={advogadoId}
                      onChange={(v) => { setErro(null); setAdvogadoId(v); }}
                      pessoas={lista}
                      excluirId={pessoaAtualId}
                      carregando={carregandoPessoas}
                      placeholder="Escolher pessoa…"
                    />
                    <p className="text-xs text-muted-foreground">
                      O horário continua {faixaDoPlantao(escala)}. Para mudar o horário, use Editar.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="edicao-pessoa" className="text-sm font-medium">Quem fica de plantão *</label>
                    <SeletorDePessoa
                      id="edicao-pessoa"
                      value={advogadoId}
                      onChange={(v) => { setErro(null); setAdvogadoId(v); }}
                      pessoas={lista}
                      carregando={carregandoPessoas}
                      placeholder="Escolher pessoa…"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="edicao-inicio" className="text-sm font-medium">Início *</label>
                      <Input id="edicao-inicio" type="time" value={horaInicio} onChange={(e) => { setErro(null); setHoraInicio(e.target.value); }} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="edicao-fim" className="text-sm font-medium">Fim *</label>
                      <Input id="edicao-fim" type="time" value={horaFim} onChange={(e) => { setErro(null); setHoraFim(e.target.value); }} />
                    </div>
                  </div>
                  {avisoHorario && (
                    <p className="flex items-start gap-2 text-sm text-muted-foreground" aria-live="polite">
                      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> {avisoHorario}
                    </p>
                  )}
                </>
              )}

              {mudaPessoa && (
                <SecaoDasConsultas
                  estado={consultasQ}
                  nomeSai={nomeSai}
                  nomeEntra={nomeEntra}
                  marcas={marcas}
                  editaAgenda={editaAgenda}
                  desabilitado={salvar.isPending}
                  onAlternar={alternar}
                />
              )}

              <div className="space-y-1.5">
                <label htmlFor="edicao-obs" className="text-sm font-medium">Observação</label>
                <Input
                  id="edicao-obs"
                  placeholder={trocar ? 'Ex.: troca combinada entre os dois' : 'Opcional'}
                  maxLength={500}
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>

              {!trocar && (
                <p className="text-xs text-muted-foreground">A data não muda aqui. Para outro dia, cadastre um plantão novo.</p>
              )}

              {sobreposicao && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {sobreposicao}
                </p>
              )}

              {erro && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {erro}
                </p>
              )}
            </div>

            {previa && nomeEntra && (
              <p className="border-t px-5 py-2.5 text-sm font-medium" aria-live="polite">
                {resumoDaTroca(nomeEntra, assumidas)}
              </p>
            )}

            <div className="flex gap-2 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end">
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
              <Button
                className="flex-1 sm:flex-none"
                onClick={submeter}
                disabled={salvar.isPending || !plano || esperandoPrevia || !!sobreposicao}
              >
                {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {trocar ? 'Passar o plantão' : 'Salvar alterações'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "Consultas marcadas neste plantão" — a prévia com decisão.
 *
 * Com erro, a troca continua possível e o PATCH vai SEM `passarConsultas`: as
 * consultas ficam com quem saiu, e a frase diz isso em vez de fingir que não há
 * nada.
 */
function SecaoDasConsultas({
  estado, nomeSai, nomeEntra, marcas, editaAgenda, desabilitado, onAlternar,
}: {
  estado: { data?: ConsultasDoPlantao; isLoading: boolean; isError: boolean; isFetching: boolean; refetch: () => unknown };
  nomeSai: string;
  nomeEntra: string;
  marcas: Record<string, boolean>;
  editaAgenda: boolean;
  desabilitado: boolean;
  onAlternar: (id: string, atual: boolean) => void;
}) {
  const d = estado.data;
  const titulo = <h4 className="text-sm font-semibold">Consultas marcadas neste plantão</h4>;

  if (estado.isLoading) {
    return (
      <section className="space-y-2">
        {titulo}
        <Carregando texto={`Conferindo a agenda ${daPessoa(nomeSai)}…`} mostrarTexto>
          <EsqueletoLinhas quantidade={2} altura={52} className="-mx-4" />
        </Carregando>
      </section>
    );
  }

  if (!d) {
    if (!estado.isError) return null;
    return (
      <section className="space-y-2">
        {titulo}
        <p className="text-sm text-muted-foreground">
          Não deu para conferir as consultas deste plantão. Dá para passar o plantão mesmo assim; as consultas continuam com {comArtigo(nomeSai)}.
        </p>
        <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={() => void estado.refetch()} disabled={estado.isFetching}>
          {estado.isFetching && <Loader2 className="h-4 w-4 animate-spin" />} Tentar de novo
        </Button>
      </section>
    );
  }

  const semLista = d.noHorario.length === 0 && d.foraDoHorario.length === 0;
  if (semLista && d.total === 0) {
    return (
      <section className="space-y-1">
        {titulo}
        <p className="text-sm text-muted-foreground">{cabecalhoDasConsultas(0, nomeSai)}</p>
      </section>
    );
  }

  const podeMarcar = d.podePassar && editaAgenda && !d.passado;
  const motivo = d.passado
    ? 'Este plantão já passou. As consultas não mudam de dono.'
    : d.porQueNaoPassa ?? (!editaAgenda
      ? `As consultas continuam com ${comArtigo(nomeSai)}. Passar consultas é de quem edita a Agenda.`
      : null);

  // Quem lê sem Agenda recebe só a contagem.
  if (semLista) {
    return (
      <section className="space-y-1">
        {titulo}
        <p className="text-sm">{cabecalhoDasConsultas(d.total, nomeSai)}</p>
        <p className="text-sm text-muted-foreground">{motivo ?? `As consultas continuam com ${comArtigo(nomeSai)}.`}</p>
      </section>
    );
  }

  const linha = (c: ConsultaDoPlantao, noHorario: boolean) => (
    <LinhaDaConsulta
      key={c.id}
      consulta={c}
      marcavel={podeMarcar && c.selecionavel}
      marcada={podeMarcar && c.selecionavel && (marcas[c.id] ?? marcadaPorPadrao(c, noHorario))}
      nomeSai={nomeSai}
      nomeEntra={nomeEntra}
      desabilitado={desabilitado}
      onAlternar={onAlternar}
    />
  );

  return (
    <section className="space-y-2">
      {titulo}
      <p className="text-sm">{cabecalhoDasConsultas(d.noHorario.length, nomeSai, d.foraDoHorario.length)}</p>
      {podeMarcar && [...d.noHorario, ...d.foraDoHorario].some((c) => c.selecionavel) && (
        <p className="text-xs text-muted-foreground">
          As marcadas passam para {comArtigo(nomeEntra)}. As desmarcadas continuam com {comArtigo(nomeSai)}.
        </p>
      )}
      {motivo && <p className="text-sm text-muted-foreground">{motivo}</p>}
      {d.noHorario.length > 0 && <ul className="-mx-2 divide-y rounded-md border">{d.noHorario.map((c) => linha(c, true))}</ul>}
      {d.foraDoHorario.length > 0 && (
        // Sem nada no horário, as de fora são tudo o que há para decidir: abertas.
        <details className="group" open={d.noHorario.length === 0 || undefined}>
          <summary className="flex min-h-[44px] cursor-pointer items-center text-sm text-muted-foreground hover:text-foreground">
            {rotuloDasForaDoHorario(d.foraDoHorario.length, nomeSai, d.noHorario.length > 0)}
          </summary>
          <ul className="-mx-2 mt-1 divide-y rounded-md border">{d.foraDoHorario.map((c) => linha(c, false))}</ul>
        </details>
      )}
    </section>
  );
}

function LinhaDaConsulta({
  consulta: c, marcavel, marcada, nomeSai, nomeEntra, desabilitado, onAlternar,
}: {
  consulta: ConsultaDoPlantao;
  marcavel: boolean;
  marcada: boolean;
  nomeSai: string;
  nomeEntra: string;
  desabilitado: boolean;
  onAlternar: (id: string, atual: boolean) => void;
}) {
  const principal = c.responsavel ? (c.responsavel.nomeExibicao || c.responsavel.nome).trim() : '';
  const choque = c.choques[0];
  const conteudo = (
    <span className="min-w-0 flex-1 space-y-0.5">
      <span className="block truncate text-sm font-medium">
        <span className="tabular-nums">{horaBR(new Date(c.inicio))}</span> · {c.filiado?.nomeCompleto ?? c.titulo}
      </span>
      <span className="block text-xs text-muted-foreground">{apoioDaConsulta(c)}</span>
      {c.papel === 'PARTICIPANTE' && (
        <span className="block text-xs text-muted-foreground">
          {principal ? `atua junto com ${comArtigo(principal)}` : `${comMaiuscula(comArtigo(nomeSai))} participa, não é quem atende`}
        </span>
      )}
      {!c.selecionavel && c.porQueNao && <span className="block text-xs text-muted-foreground">{c.porQueNao}</span>}
      {marcada && c.temLink && (
        <span className="block text-xs text-muted-foreground">
          O link da chamada foi criado antes da troca; confira com {comArtigo(nomeEntra)}.
        </span>
      )}
      {marcada && choque && (
        <span className="flex items-start gap-1 text-xs text-muted-foreground">
          <CalendarClock aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" /> {fraseDoChoque(nomeEntra, choque)}
        </span>
      )}
    </span>
  );

  if (!marcavel) return <li className="flex min-h-[44px] items-start gap-3 px-3 py-2">{conteudo}</li>;
  return (
    <li>
      <label className={cn('flex min-h-[44px] cursor-pointer items-start gap-3 px-3 py-2 active:bg-muted/40', desabilitado && 'cursor-default')}>
        <input
          type="checkbox"
          checked={marcada}
          disabled={desabilitado}
          onChange={() => onAlternar(c.id, marcada)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
        />
        {conteudo}
      </label>
    </li>
  );
}

/**
 * O 2º PASSO, só quando alguma consulta passou: quem assumiu e o botão de
 * WhatsApp por consulta. Nada é enviado sozinho — não há canal fora do sistema,
 * e a mensagem vai sem o link da chamada (a sala pode ser de quem saiu).
 */
function PassoDoPlantaoPassado({ passado, dia, veTelefone }: { passado: PlantaoPassado; dia: string; veTelefone: boolean }) {
  const { entra, resultado, consultas } = passado;
  const ignoradas = frasesDasIgnoradas(resultado.ignoradas);
  const pessoaEntra = { nome: entra };
  // Nada marcava qual filiado já foi avisado: com três consultas, quem estava na
  // tela perdia a conta (15/09/2026). O botão tocado vira "Aberto" e continua
  // tocável, para reabrir se a conversa foi fechada sem enviar. Só na tela:
  // abrir o WhatsApp não prova que a mensagem saiu.
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-5">
      <p className="text-sm">{textoDoPlantaoPassado(entra, dia, resultado.passadas)}</p>
      <ul className="space-y-3">
        {resultado.passadas.map((p) => {
          const nome = p.filiado?.nomeCompleto ?? consultas.get(p.id)?.titulo ?? 'Consulta';
          const celular = celularDaConsultaPassada(p.filiado);
          const aviso = avisoDaConsultaPassada(p, entra, consultas.get(p.id)?.responsavel);
          return (
            <li key={p.id} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">
                {nome} · <span className="tabular-nums">{horaBR(new Date(p.inicio))}</span>
              </p>
              {aviso.tipo === 'INFORMATIVO' ? (
                <p className="text-xs text-muted-foreground">{aviso.texto}</p>
              ) : celular && p.filiado ? (
                <Button
                  variant={abertos.has(p.id) ? 'outline' : 'default'}
                  aria-label={abertos.has(p.id) ? `Abrir de novo o WhatsApp de ${nome}` : undefined}
                  className={cn(
                    'min-h-[44px] w-full',
                    !abertos.has(p.id) && 'bg-[#25D366] text-white hover:bg-[#20bd5a]',
                  )}
                  onClick={() => {
                    window.open(
                      linkWhatsApp(celular, mensagemDaTrocaDeAdvogado({ nomeFiliado: p.filiado!.nomeCompleto, entra: pessoaEntra, inicio: p.inicio })),
                      '_blank',
                      'noopener,noreferrer',
                    );
                    setAbertos((atual) => new Set(atual).add(p.id));
                  }}
                >
                  {abertos.has(p.id)
                    ? <><Check className="h-4 w-4" /> Aberto</>
                    : <><WhatsAppIcon className="h-4 w-4" /> Avisar pelo WhatsApp</>}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {!p.filiado
                    ? 'Consulta sem filiado ligado.'
                    : veTelefone
                      ? 'Sem celular no cadastro.'
                      : 'O telefone do filiado não aparece para o seu perfil.'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {ignoradas.map((f) => (
        <p key={f} className="text-sm text-muted-foreground">{f}</p>
      ))}
    </div>
  );
}

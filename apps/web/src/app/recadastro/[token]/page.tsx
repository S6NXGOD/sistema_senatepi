'use client';

import { LIMITES_NASCIMENTO, LIMITES_DATA_PASSADA } from '@/lib/datas-limite';
import { use, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ShieldCheck, Loader2, CheckCircle2, AlertTriangle, Lock, Save, User,
  Upload, Plus, Trash2, Briefcase, Users, RefreshCw, IdCard, ArrowRight, KeyRound,} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Carregando, Esqueleto } from '@/components/ui/esqueleto';
import { PhotoCropDialog } from '@/components/photo-crop-dialog';
import {
  abrirLink, validarDesafio, enviarRecadastro, enviarFotoRecadastro,
  type PrimeiroAcessoAoPortal,
  mascaraCpf, mascaraTelefone, mascaraCep,
  pedidoDoDesafio, respostaDoDesafio, faltaNoDesafio, destinoDoErroDoDesafio, telaDoLinkDireto,
  SEXOS, ESTADOS_CIVIS, FORMACOES, ROTULO, TIPOS_DEPENDENTE,
  type LinkAberto, type FiliadoRecadastro, type VinculoFiliado, type DependenteFiliado,
} from '@/lib/recadastro';
import { erroDoCpf } from '@/lib/cpf';
import { travado, type CampoImutavel } from '@/lib/campos-imutaveis';
import { tenant } from '@/tenant.config';
import { campoVisivel } from '@/tenant.config';

const campo = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-11';

/*
  15/09/2026: o `<label>` ficava ao lado do campo, sem ligação nenhuma. O leitor
  de tela anunciava "caixa de texto" sem nome, e tocar no rótulo não levava ao
  campo. Envolver o campo no rótulo liga os dois em todo formulário da página,
  sem um id para cada.
*/
function Campo({ label, children, dica, bloqueado, alerta }: {
  label: string;
  children: React.ReactNode;
  dica?: string;
  /** Dado que não muda e já consta no cadastro. */
  bloqueado?: boolean;
  /**
   * A dica está IMPEDINDO de seguir, e não só informando.
   *
   * Mesma linha, mesmo lugar — muda a cor. Um segundo aviso em outro canto
   * dizendo a mesma frase é o erro que a Agenda já cometeu: a pessoa lê duas
   * vezes e procura a diferença que não existe.
   */
  alerta?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="flex items-center gap-1 text-sm font-medium">
          {label}
          {bloqueado && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
        </span>
        {children}
      </label>
      {bloqueado && (
        <p className="text-xs text-muted-foreground">
          Não muda ao longo da vida. Se estiver errado, fale com o sindicato.
        </p>
      )}
      {dica && (
        <p className={alerta ? 'text-xs font-medium text-amber-700 dark:text-amber-400' : 'text-xs text-muted-foreground'}>
          {dica}
        </p>
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{titulo}</h2>
      {children}
    </section>
  );
}

/**
 * Recadastramento ONLINE — página PÚBLICA, acessada pelo filiado com o link
 * de 24h. Três estados: confirmação de identidade → formulário → recibo.
 */
/**
 * O endereço do portal como a pessoa vai digitar depois — com o host, porque
 * ela vai fechar esta página e abrir de novo mais tarde, talvez em outro
 * aparelho. Só "/filiado" não ajuda quem já saiu do site.
 */
function enderecoDoPortal(): string {
  if (typeof window === 'undefined') return '/filiado';
  return `${window.location.host}/filiado`;
}

export default function RecadastroPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [carregando, setCarregando] = useState(true);
  const [erroLink, setErroLink] = useState<string | null>(null);
  const [link, setLink] = useState<LinkAberto | null>(null);

  // Desafio
  const [cpf, setCpf] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [coren, setCoren] = useState('');
  const [validando, setValidando] = useState(false);
  /** Uma tentativa já terminou: só depois dela o link direto pode dizer que falhou. */
  const [tentouUmaVez, setTentouUmaVez] = useState(false);
  /** A linha fixa acima do botão: dado que falta ou "Restam N tentativa(s)". */
  const [erroDesafio, setErroDesafio] = useState<string | null>(null);

  // Formulário
  const [f, setF] = useState<FiliadoRecadastro | null>(null);
  /** Fotografia dos imutáveis como vieram do servidor. */
  const [travadoOriginal, setTravadoOriginal] = useState<Record<string, unknown>>({});
  const [salvando, setSalvando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  /* A senha do portal, quando o recadastramento acabou de criar o acesso. */
  const [portal, setPortal] = useState<PrimeiroAcessoAoPortal | null>(null);

  // Foto
  const [foto, setFoto] = useState<Blob | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [arquivoCrop, setArquivoCrop] = useState<File | null>(null);

  useEffect(() => {
    abrirLink(token)
      .then(setLink)
      .catch((e: Error) => setErroLink(e.message))
      .finally(() => setCarregando(false));
  }, [token]);

  /*
    Link NENHUM antigo: abre direto. Desde 14/09/2026 a API não gera mais esse
    link, mas os que já estavam vivos continuam abrindo até vencer (24h).
    Deps à mão (o web não tem ESLint): só `link`. `confirmar` lê o estado da
    hora, e o `!f` impede rodar de novo depois de aberto.
  */
  useEffect(() => {
    if (link && pedidoDoDesafio(link.desafio).tipo === 'DIRETO' && !f) void confirmar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  /** O que a pessoa digitou, só nos campos que o desafio pede. */
  const valoresDoDesafio = () => ({ cpf, nascimento, coren });

  async function confirmar() {
    const pedido = pedidoDoDesafio(link?.desafio);
    const falta = faltaNoDesafio(pedido, valoresDoDesafio());
    if (falta) {
      setErroDesafio(falta);
      return;
    }
    setErroDesafio(null);
    setValidando(true);
    try {
      const r = await validarDesafio(token, respostaDoDesafio(pedido, valoresDoDesafio()));
      /*
        O QUE A PESSOA ACABOU DE DIGITAR JÁ VAI PREENCHIDO — 22/09/2026, e sem
        isto o recurso inteiro não fecha o ciclo.

        Visto na tela: numa ficha em branco, a pessoa informa CPF e nascimento
        no portão, entra no formulário — e os dois campos estão VAZIOS, porque
        o formulário é preenchido com o que o banco tem, e o banco não tem
        nada. Pedir para digitar duas vezes seguidas o mesmo número já é ruim;
        pior é o que acontece se ela não digitar de novo: o recadastramento
        salva sem CPF, a ficha continua em branco, e o próximo link volta a ser
        IDENTIFICACAO. O trabalho todo se perde em silêncio.

        Só em IDENTIFICACAO. Nos outros desafios o cadastro TEM os valores, e
        eles vêm do banco — que é a fonte certa.

        `travadoOriginal` continua recebendo o que veio do BANCO (nulo), e é o
        que mantém os dois campos editáveis: `protegerImutaveis` só libera
        campo vazio, e é a ficha vazia que estamos preenchendo.
      */
      const identificou = link?.desafio === 'IDENTIFICACAO';
      setF(
        identificou
          ? { ...r.filiado, cpf: cpf.replace(/\D/g, ''), dataNascimento: nascimento }
          : r.filiado,
      );
      setTravadoOriginal({
        cpf: r.filiado.cpf, rg: r.filiado.rg, ufRg: r.filiado.ufRg,
        dataNascimento: r.filiado.dataNascimento, naturalidade: r.filiado.naturalidade,
      });
      setFotoPreview(r.filiado.fotoUrl ?? null);
    } catch (e) {
      // Link morto (bloqueado na 5ª, cancelado, vencido): a tela de "Link
      // indisponível". Dado errado: a linha fixa, com as tentativas que restam.
      const msg = (e as Error).message;
      if (destinoDoErroDoDesafio(e) === 'LINK') setErroLink(msg);
      else setErroDesafio(msg);
    } finally {
      setValidando(false);
      setTentouUmaVez(true);
    }
  }

  /**
   * Trava pelo valor ORIGINAL do cadastro (`travadoOriginal`), não pelo que
   * está no formulário: usar o estado atual destravaria o campo assim que o
   * filiado apagasse o conteúdo.
   */
  const bloq = (c: CampoImutavel) => travado(c, travadoOriginal[c]);

  const set = <K extends keyof FiliadoRecadastro>(k: K, v: FiliadoRecadastro[K]) =>
    setF((atual) => (atual ? { ...atual, [k]: v } : atual));

  // ------------------------------------------------------------------- foto

  function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setArquivoCrop(file); // abre o recorte, igual ao formulário da equipe
    e.target.value = '';
  }

  function aplicarCrop(blob: Blob) {
    setFoto(blob);
    if (fotoPreview?.startsWith('blob:')) URL.revokeObjectURL(fotoPreview);
    setFotoPreview(URL.createObjectURL(blob));
    setArquivoCrop(null);
  }

  // --------------------------------------------------------------- vínculos

  const vinculos = f?.vinculos ?? [];

  function mudarVinculo(i: number, campo: keyof VinculoFiliado, valor: string) {
    setF((atual) => {
      if (!atual) return atual;
      const lista = [...(atual.vinculos ?? [])];
      lista[i] = { ...lista[i], [campo]: valor };
      return { ...atual, vinculos: lista };
    });
  }

  function addVinculo() {
    setF((atual) =>
      atual
        ? { ...atual, vinculos: [...(atual.vinculos ?? []), { empresa: '', cargo: '', matricula: '' }] }
        : atual,
    );
  }

  function removerVinculo(i: number) {
    setF((atual) =>
      atual ? { ...atual, vinculos: (atual.vinculos ?? []).filter((_, j) => j !== i) } : atual,
    );
  }

  // ------------------------------------------------------------- dependentes

  const dependentes = f?.dependentes ?? [];

  function mudarDependente(i: number, campo: keyof DependenteFiliado, valor: string) {
    setF((atual) => {
      if (!atual) return atual;
      const lista = [...(atual.dependentes ?? [])];
      lista[i] = { ...lista[i], [campo]: valor };
      return { ...atual, dependentes: lista };
    });
  }

  function addDependente() {
    setF((atual) =>
      atual
        ? {
            ...atual,
            dependentes: [
              ...(atual.dependentes ?? []),
              { tipo: 'FILHO', nome: '', cpf: '', dataNascimento: '' },
            ],
          }
        : atual,
    );
  }

  function removerDependente(i: number) {
    setF((atual) =>
      atual ? { ...atual, dependentes: (atual.dependentes ?? []).filter((_, j) => j !== i) } : atual,
    );
  }

  async function salvar() {
    if (!f) return;
    if (f.nomeCompleto.trim().length < 3) return toast.error('Informe o nome completo.');
    setSalvando(true);
    // Confirmação repetida — o servidor revalida antes de gravar a foto e o envio.
    // Só os campos do desafio: o mesmo recorte do /validar.
    const confirmacao = respostaDoDesafio(pedidoDoDesafio(link?.desafio), valoresDoDesafio());
    try {
      // A foto vai primeiro: o envio abaixo queima o link.
      if (foto) await enviarFotoRecadastro(token, foto, confirmacao);

      const resposta = await enviarRecadastro(token, {
        cpfConfirmacao: confirmacao.cpf,
        dataNascimentoConfirmacao: confirmacao.dataNascimento,
        corenConfirmacao: confirmacao.coren,
        nomeCompleto: f.nomeCompleto.trim(),
        cpf: f.cpf?.replace(/\D/g, '') || undefined,
        rg: f.rg || undefined,
        ufRg: f.ufRg || undefined,
        dataNascimento: f.dataNascimento ? f.dataNascimento.slice(0, 10) : undefined,
        sexo: f.sexo || undefined,
        estadoCivil: f.estadoCivil || undefined,
        naturalidade: f.naturalidade || undefined,
        telefonePrincipal: f.telefonePrincipal || undefined,
        telefoneSecundario: f.telefoneSecundario || undefined,
        email: f.email || undefined,
        cep: f.cep || undefined,
        endereco: f.endereco || undefined,
        numero: f.numero || undefined,
        complemento: f.complemento || undefined,
        bairro: f.bairro || undefined,
        cidade: f.cidade || undefined,
        estado: f.estado || undefined,
        formacao: f.formacao || undefined,
        formacaoOutro: f.formacaoOutro || undefined,
        numeroCoren: f.numeroCoren || undefined,
        dataAdmissao: f.dataAdmissao ? f.dataAdmissao.slice(0, 10) : undefined,
        // Idem para os dependentes: a lista enviada vira a verdade. Linhas sem
        // nome ou sem data de nascimento são descartadas.
        dependentes: dependentes
          .filter((d) => d.nome?.trim() && d.dataNascimento)
          .map((d) => ({
            id: d.id,
            tipo: d.tipo,
            nome: d.nome.trim(),
            cpf: d.cpf?.replace(/\D/g, '') || undefined,
            dataNascimento: d.dataNascimento.slice(0, 10),
          })),
        // A lista enviada substitui a do cadastro: é assim que o filiado
        // consegue remover um emprego que não tem mais. Linhas sem instituição
        // são descartadas para não gravar vínculo em branco.
        vinculos: vinculos
          .filter((v) => v.empresa?.trim())
          .map((v, i) => ({
            empresa: v.empresa.trim(),
            cargo: v.cargo?.trim() || undefined,
            matricula: v.matricula?.trim() || undefined,
            ordem: i + 1,
          })),
      });
      setPortal(resposta?.portal ?? null);
      setConcluido(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  // ---------------------------------------------------------------- estados

  if (carregando) {
    return (
      <Moldura>
        <EsqueletoDaConfirmacao texto="Abrindo seu link…" />
      </Moldura>
    );
  }

  if (erroLink) {
    return (
      <Moldura>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500" />
          <h1 className="text-lg font-bold">Link indisponível</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{erroLink}</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Entre em contato com o {tenant.sigla} para receber um novo link de recadastramento.
          </p>
        </div>
      </Moldura>
    );
  }

  if (concluido) {
    return (
      <Moldura>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-brand-600" />
          <h1 className="text-lg font-bold">Cadastro atualizado!</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Obrigado, {link?.primeiroNome}. Seus dados foram enviados ao {tenant.sigla} e serão
            conferidos pela equipe.
          </p>

          {/*
            A SENHA DO PORTAL NASCE AQUI, e esta é a ÚNICA vez que ela aparece:
            o sistema guarda só o embaralhado. A caixa vem depois do "obrigado"
            de propósito — a pessoa já entendeu que deu certo, e agora ganha uma
            coisa a mais, em vez de um bloco de senha logo na cara.
          */}
          {portal && (
            <div className="mt-2 w-full max-w-sm rounded-2xl border border-brand-200 bg-brand-50/70 p-4 text-left dark:border-brand-900/70 dark:bg-brand-900/20">
              <p className="flex items-center gap-1.5 text-sm font-bold text-brand-900 dark:text-brand-200">
                <KeyRound className="h-4 w-4" /> Seu acesso ao portal
              </p>
              <p className="mt-1 text-xs leading-snug text-brand-900/80 dark:text-brand-200/80">
                Agora você pode ver sua carteirinha, seus processos e seu cadastro pelo celular.
              </p>

              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-300">
                Senha provisória
              </p>
              {/* Monoespaçada e grande: ela vai ser copiada à mão para o teclado. */}
              <p className="select-all font-mono text-xl font-bold tracking-wide">
                {portal.senhaProvisoria}
              </p>

              <p className="mt-2 text-xs leading-snug text-brand-900/80 dark:text-brand-200/80">
                <strong>Anote agora</strong> — ela não aparece de novo. Entre em{' '}
                <a href="/filiado" className="font-semibold underline">
                  {enderecoDoPortal()}
                </a>{' '}
                com o seu CPF e troque a senha no primeiro acesso.
              </p>
            </div>
          )}

          <p className="max-w-sm text-xs text-muted-foreground">
            Este link já foi utilizado e não pode ser aberto novamente.
          </p>
        </div>
      </Moldura>
    );
  }

  // ------------------------------------------------------------- 1) desafio

  if (!f) {
    const pedido = pedidoDoDesafio(link?.desafio);
    /*
      FICHA EM BRANCO: a tela PEDE, não confere (22/09/2026). Muda o ícone, o
      verbo do botão e o rodapé — o formulário é o mesmo, porque os campos são
      os mesmos. Ver `pedidoDoDesafio` e a migração
      `20260922120000_link_de_identificacao`.
    */
    const identificacao = link?.desafio === 'IDENTIFICACAO';

    /*
      Valor que esta página não conhece: nunca cair no formulário de CPF e data
      (a pessoa gastaria as 5 tentativas num formulário que não confere).
    */
    if (pedido.tipo === 'DESATUALIZADA') {
      return (
        <Moldura>
          <div className="mx-auto flex max-w-sm animate-surgir flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
            <h1 className="text-lg font-bold">Olá, {link?.primeiroNome}!</h1>
            <p className="text-sm text-muted-foreground">
              Esta página está desatualizada. Recarregue para continuar.
            </p>
            <Button className="h-12 w-full" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" /> Recarregar
            </Button>
          </div>
        </Moldura>
      );
    }

    /*
      Link antigo sem confirmação: o efeito acima já está abrindo o cadastro.
      15/09/2026: antes da primeira tentativa terminar é sempre "abrindo". No
      primeiro desenho `validando` ainda era falso, e a página piscava "Não foi
      possível abrir o seu cadastro." antes de abrir (`telaDoLinkDireto`).
    */
    if (pedido.tipo === 'DIRETO') {
      return (
        <Moldura>
          {telaDoLinkDireto({ validando, tentouUmaVez }) === 'ABRINDO' ? (
            <EsqueletoDaConfirmacao texto="Abrindo seu cadastro…" />
          ) : (
            <div className="mx-auto flex max-w-sm animate-surgir flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {erroDesafio ?? 'Não foi possível abrir o seu cadastro.'}
              </p>
              <Button className="h-12 w-full" onClick={confirmar}>
                <RefreshCw className="h-4 w-4" /> Tentar de novo
              </Button>
            </div>
          )}
        </Moldura>
      );
    }

    return (
      <Moldura>
        <form
          className="mx-auto max-w-sm animate-surgir space-y-5 py-6"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar();
          }}
        >
          {/*
            O CADEADO MENTE QUANDO NÃO HÁ O QUE CONFERIR — 22/09/2026.

            Nos outros desafios a tela está checando um segredo guardado, e o
            cadeado diz isso. Numa ficha em branco não há segredo: a tela está
            PEDINDO um dado pela primeira vez. Manter o cadeado faria a pessoa
            achar que o sistema conferiu alguma coisa — e faria a equipe achar
            o mesmo. Documento aberto, não cadeado.
          */}
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/30">
              {identificacao ? (
                <IdCard className="h-6 w-6 text-brand-800 dark:text-brand-400" />
              ) : (
                <Lock className="h-6 w-6 text-brand-800 dark:text-brand-400" />
              )}
            </div>
            <h1 className="text-lg font-bold">Olá, {link?.primeiroNome}!</h1>
            <p className="mt-1 text-sm text-muted-foreground">{pedido.frase}</p>
          </div>

          {/*
            O AVISO DO CPF SAI ENQUANTO SE DIGITA, e só depois do 11º número:
            campo que fica vermelho no primeiro caractere ensina a ignorar o
            vermelho. Ver `erroDoCpf`.
          */}
          {pedido.campos.includes('CPF') && (
            <Campo label="CPF" dica={erroDoCpf(cpf) ?? undefined} alerta={!!erroDoCpf(cpf)}>
              <Input className={campo} inputMode="numeric" autoComplete="off" value={cpf} onChange={(e) => setCpf(mascaraCpf(e.target.value))} placeholder="000.000.000-00" />
            </Campo>
          )}
          {pedido.campos.includes('NASCIMENTO') && (
            <Campo label="Data de nascimento">
              <Input className={campo} type="date" {...LIMITES_NASCIMENTO} value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
            </Campo>
          )}
          {pedido.campos.includes('COREN') && (
            <Campo label="Número do COREN" dica="Como está no seu registro profissional.">
              <Input className={campo} autoComplete="off" autoCapitalize="characters" value={coren} onChange={(e) => setCoren(e.target.value)} placeholder="COREN-PI 000000-ENF" />
            </Campo>
          )}

          {/*
            15/09/2026: "Restam N tentativa(s)" saía num toast que some. Fica
            aqui, fixo acima do botão, até a próxima tentativa. Âmbar: é aviso
            de quantas restam, não falha do sistema.
          */}
          {/*
            A FAIXA CALA O QUE O CAMPO JÁ DIZ — 22/09/2026.

            Com o dígito verificador conferido na tela, "Este CPF não parece
            certo" saía DUAS vezes: embaixo do campo e outra vez aqui. A faixa
            existe para o que a tela não mostra (quantas tentativas restam, o
            link bloqueado); repetir a linha do campo só faz procurar a
            diferença entre as duas.
          */}
          {erroDesafio && erroDesafio !== erroDoCpf(cpf) && (
            <p role="alert" className="flex animate-surgir items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{erroDesafio}</span>
            </p>
          )}

          <Button type="submit" className="h-12 w-full" disabled={validando}>
            {validando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : identificacao ? (
              <ArrowRight className="h-4 w-4" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            {identificacao ? 'Continuar' : 'Confirmar e continuar'}
          </Button>
          {/*
            O RODAPÉ TEM DE SER VERDADE. "5 tentativas erradas" é o contador do
            desafio, e em IDENTIFICACAO errar a digitação NÃO gasta tentativa —
            a API trata o formato antes de reservar. Repetir a frase ali
            assustaria à toa quem só errou um número.
          */}
          <p className="text-center text-xs text-muted-foreground">
            {identificacao
              ? 'Estes dados entram no seu cadastro e o sindicato confere depois.'
              : 'Depois de 5 tentativas erradas o link é bloqueado por segurança.'}
          </p>
        </form>
      </Moldura>
    );
  }

  // --------------------------------------------------------- 2) formulário

  return (
    <Moldura>
      {arquivoCrop && (
        <PhotoCropDialog
          arquivo={arquivoCrop}
          aspect={3 / 4}
          onConfirm={aplicarCrop}
          onClose={() => setArquivoCrop(null)}
        />
      )}
      <div className="space-y-5 py-4">
        <div>
          <h1 className="text-xl font-bold">Atualize seu cadastro</h1>
          <p className="text-sm text-muted-foreground">
            Confira e corrija o que estiver desatualizado. Matrícula {f.matricula}.
          </p>
        </div>

        <Secao titulo="Sua foto">
          <div className="flex items-center gap-4">
            {fotoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotoPreview} alt="" className="h-24 w-20 rounded-xl object-cover" />
            ) : (
              <div className="flex h-24 w-20 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <User className="h-8 w-8" />
              </div>
            )}
            <div className="min-w-0">
              <input type="file" accept="image/*" id="foto-recadastro" className="hidden" onChange={escolherFoto} />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('foto-recadastro')?.click()}
              >
                <Upload className="h-4 w-4" /> {fotoPreview ? 'Trocar foto' : 'Enviar foto'}
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Usada na sua carteirinha. Rosto visível, fundo claro.
              </p>
            </div>
          </div>
        </Secao>

        <Secao titulo="Dados pessoais">
          <Campo label="Nome completo *">
            <Input className={campo} value={f.nomeCompleto} onChange={(e) => set('nomeCompleto', e.target.value)} />
          </Campo>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="CPF" bloqueado={bloq('cpf')}>
              <Input className={campo + (bloq('cpf') ? ' bg-muted' : '')} readOnly={bloq('cpf')} inputMode="numeric" value={mascaraCpf(f.cpf ?? '')} onChange={(e) => set('cpf', mascaraCpf(e.target.value))} placeholder="000.000.000-00" />
            </Campo>
            <Campo label="Data de nascimento" bloqueado={bloq('dataNascimento')}>
              <Input className={campo + (bloq('dataNascimento') ? ' bg-muted' : '')} readOnly={bloq('dataNascimento')} type="date" {...LIMITES_NASCIMENTO} value={f.dataNascimento?.slice(0, 10) ?? ''} onChange={(e) => set('dataNascimento', e.target.value)} />
            </Campo>
            <Campo label="RG" bloqueado={bloq('rg')}>
              <Input className={campo + (bloq('rg') ? ' bg-muted' : '')} readOnly={bloq('rg')} value={f.rg ?? ''} onChange={(e) => set('rg', e.target.value)} />
            </Campo>
            <Campo label="UF do RG" bloqueado={bloq('ufRg')}>
              <Input className={campo + (bloq('ufRg') ? ' bg-muted' : '')} readOnly={bloq('ufRg')} maxLength={2} value={f.ufRg ?? ''} onChange={(e) => set('ufRg', e.target.value.toUpperCase())} />
            </Campo>
            <Campo label="Sexo">
              <select className={campo} value={f.sexo ?? ''} onChange={(e) => set('sexo', e.target.value)}>
                <option value="">Não informar</option>
                {SEXOS.map((s) => <option key={s} value={s}>{ROTULO[s] ?? s}</option>)}
              </select>
            </Campo>
            <Campo label="Estado civil">
              <select className={campo} value={f.estadoCivil ?? ''} onChange={(e) => set('estadoCivil', e.target.value)}>
                <option value="">Não informar</option>
                {ESTADOS_CIVIS.map((s) => <option key={s} value={s}>{ROTULO[s] ?? s}</option>)}
              </select>
            </Campo>
            <Campo label="Naturalidade" bloqueado={bloq('naturalidade')}>
              <Input className={campo + (bloq('naturalidade') ? ' bg-muted' : '')} readOnly={bloq('naturalidade')} value={f.naturalidade ?? ''} onChange={(e) => set('naturalidade', e.target.value)} />
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Contato">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="Telefone principal">
              <Input className={campo} inputMode="tel" value={mascaraTelefone(f.telefonePrincipal ?? '')} onChange={(e) => set('telefonePrincipal', mascaraTelefone(e.target.value))} placeholder="(86) 90000-0000" />
            </Campo>
            <Campo label="Telefone secundário">
              <Input className={campo} inputMode="tel" value={mascaraTelefone(f.telefoneSecundario ?? '')} onChange={(e) => set('telefoneSecundario', mascaraTelefone(e.target.value))} />
            </Campo>
            <Campo label="E-mail">
              <Input className={campo} type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Endereço">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="CEP">
              <Input className={campo} inputMode="numeric" value={mascaraCep(f.cep ?? '')} onChange={(e) => set('cep', mascaraCep(e.target.value))} placeholder="00000-000" />
            </Campo>
            <Campo label="Endereço">
              <Input className={campo} value={f.endereco ?? ''} onChange={(e) => set('endereco', e.target.value)} />
            </Campo>
            <Campo label="Número">
              <Input className={campo} value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} />
            </Campo>
            <Campo label="Complemento">
              <Input className={campo} value={f.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} />
            </Campo>
            <Campo label="Bairro">
              <Input className={campo} value={f.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} />
            </Campo>
            <Campo label="Cidade">
              <Input className={campo} value={f.cidade ?? ''} onChange={(e) => set('cidade', e.target.value)} />
            </Campo>
            <Campo label="Estado">
              <Input className={campo} maxLength={2} value={f.estado ?? ''} onChange={(e) => set('estado', e.target.value.toUpperCase())} />
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Dados profissionais">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="Formação">
              <select className={campo} value={f.formacao ?? ''} onChange={(e) => set('formacao', e.target.value)}>
                <option value="">Não informar</option>
                {FORMACOES.map((s) => <option key={s} value={s}>{ROTULO[s] ?? s}</option>)}
              </select>
            </Campo>
            {f.formacao === 'OUTRO' && (
              <Campo label="Qual formação?">
                <Input className={campo} value={f.formacaoOutro ?? ''} onChange={(e) => set('formacaoOutro', e.target.value)} />
              </Campo>
            )}
            {campoVisivel('numeroCoren') && (
              <Campo label="Número do COREN" dica="Formato: COREN-PI 000000-ENF">
                <Input className={campo} value={f.numeroCoren ?? ''} onChange={(e) => set('numeroCoren', e.target.value)} />
              </Campo>
            )}
            <Campo label="Data de admissão">
              <Input className={campo} type="date" {...LIMITES_DATA_PASSADA} value={f.dataAdmissao?.slice(0, 10) ?? ''} onChange={(e) => set('dataAdmissao', e.target.value)} />
            </Campo>
          </div>
        </Secao>

        <Secao titulo="Vínculos de trabalho">
          <p className="-mt-2 text-xs text-muted-foreground">
            Onde você trabalha hoje. Se tiver mais de um emprego, cadastre todos.
          </p>

          {vinculos.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum vínculo cadastrado.
            </p>
          )}

          <div className="space-y-4">
            {vinculos.map((v, i) => (
              <div key={v.id ?? `novo-${i}`} className="space-y-4 rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Briefcase className="h-3.5 w-3.5" /> Vínculo {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removerVinculo(i)}
                    className="flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remover
                  </button>
                </div>
                <Campo label="Instituição / Empresa">
                  <Input
                    className={campo}
                    value={v.empresa ?? ''}
                    onChange={(e) => mudarVinculo(i, 'empresa', e.target.value)}
                    placeholder="Ex.: Hospital Getúlio Vargas"
                  />
                </Campo>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Campo label="Cargo">
                    <Input className={campo} value={v.cargo ?? ''} onChange={(e) => mudarVinculo(i, 'cargo', e.target.value)} />
                  </Campo>
                  <Campo label="Matrícula na instituição">
                    <Input className={campo} value={v.matricula ?? ''} onChange={(e) => mudarVinculo(i, 'matricula', e.target.value)} />
                  </Campo>
                </div>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={addVinculo}>
            <Plus className="h-4 w-4" /> Adicionar vínculo
          </Button>
        </Secao>

        <Secao titulo="Dependentes">
          <p className="-mt-2 text-xs text-muted-foreground">
            Cônjuge e filhos(as). Eles usam a carteirinha e participam dos eventos do sindicato.
          </p>

          {dependentes.length === 0 && (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Nenhum dependente cadastrado.
            </p>
          )}

          <div className="space-y-4">
            {dependentes.map((d, i) => (
              <div key={d.id ?? `novo-${i}`} className="space-y-4 rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Dependente {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removerDependente(i)}
                    className="flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remover
                  </button>
                </div>
                <Campo label="Nome completo">
                  <Input
                    className={campo}
                    value={d.nome ?? ''}
                    onChange={(e) => mudarDependente(i, 'nome', e.target.value)}
                  />
                </Campo>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Campo label="Parentesco">
                    <select
                      className={campo}
                      value={d.tipo}
                      onChange={(e) => mudarDependente(i, 'tipo', e.target.value)}
                    >
                      {TIPOS_DEPENDENTE.map((t) => (
                        <option key={t.valor} value={t.valor}>{t.rotulo}</option>
                      ))}
                    </select>
                  </Campo>
                  <Campo label="Data de nascimento">
                    <Input
                      className={campo}
                      type="date"
                      {...LIMITES_NASCIMENTO}
                      value={d.dataNascimento?.slice(0, 10) ?? ''}
                      onChange={(e) => mudarDependente(i, 'dataNascimento', e.target.value)}
                    />
                  </Campo>
                  <Campo label="CPF">
                    <Input
                      className={campo}
                      inputMode="numeric"
                      value={mascaraCpf(d.cpf ?? '')}
                      onChange={(e) => mudarDependente(i, 'cpf', mascaraCpf(e.target.value))}
                      placeholder="000.000.000-00"
                    />
                  </Campo>
                </div>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={addDependente}>
            <Plus className="h-4 w-4" /> Adicionar dependente
          </Button>
        </Secao>

        <div className="sticky bottom-0 -mx-4 border-t bg-card/95 p-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <Button className="w-full" onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Enviar atualização
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Ao enviar, o link é encerrado. Seus dados são tratados conforme a LGPD (Lei nº 13.709/2018).
          </p>
        </div>
      </div>
    </Moldura>
  );
}

/**
 * A FORMA DA PRIMEIRA TELA enquanto o link abre (15/09/2026): saudação, dois
 * campos e o botão, no lugar do girador. Quando o formulário chega, nada pula.
 */
function EsqueletoDaConfirmacao({ texto }: { texto: string }) {
  return (
    <Carregando texto={texto} className="mx-auto max-w-sm py-6">
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-2">
          <Esqueleto className="h-12 w-12 rounded-2xl" />
          <Esqueleto className="h-5 w-40" />
          <Esqueleto className="h-3.5 w-64 max-w-full" />
        </div>
        <div className="space-y-1.5">
          <Esqueleto className="h-3.5 w-16" />
          <Esqueleto className="h-12 w-full md:h-11" />
        </div>
        <div className="space-y-1.5">
          <Esqueleto className="h-3.5 w-32" />
          <Esqueleto className="h-12 w-full md:h-11" />
        </div>
        <Esqueleto className="h-12 w-full" />
      </div>
    </Carregando>
  );
}

/** Casca visual da área pública (sem menu, sem sessão). */
function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cinza-claro dark:bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Logo orientation="horizontal" variant="auto" className="h-8" />
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3.5 w-3.5" /> Recadastramento
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-10">{children}</main>
    </div>
  );
}

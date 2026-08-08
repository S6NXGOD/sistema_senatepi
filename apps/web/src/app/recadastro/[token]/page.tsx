'use client';

import { LIMITES_NASCIMENTO, LIMITES_DATA_PASSADA } from '@/lib/datas-limite';
import { use, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ShieldCheck, Loader2, CheckCircle2, AlertTriangle, Lock, Save, User,
  Upload, Plus, Trash2, Briefcase, Users,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhotoCropDialog } from '@/components/photo-crop-dialog';
import {
  abrirLink, validarDesafio, enviarRecadastro, enviarFotoRecadastro,
  mascaraCpf, mascaraTelefone, mascaraCep,
  SEXOS, ESTADOS_CIVIS, FORMACOES, ROTULO, TIPOS_DEPENDENTE,
  type LinkAberto, type FiliadoRecadastro, type VinculoFiliado, type DependenteFiliado,
} from '@/lib/recadastro';
import { travado, type CampoImutavel } from '@/lib/campos-imutaveis';
import { tenant } from '@/tenant.config';

const campo = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-11';

function Campo({ label, children, dica, bloqueado }: {
  label: string;
  children: React.ReactNode;
  dica?: string;
  /** Dado que não muda e já consta no cadastro. */
  bloqueado?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-sm font-medium">
        {label}
        {bloqueado && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
      </label>
      {children}
      {bloqueado && (
        <p className="text-xs text-muted-foreground">
          Não muda ao longo da vida. Se estiver errado, fale com o sindicato.
        </p>
      )}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
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

  // Formulário
  const [f, setF] = useState<FiliadoRecadastro | null>(null);
  /** Fotografia dos imutáveis como vieram do servidor. */
  const [travadoOriginal, setTravadoOriginal] = useState<Record<string, unknown>>({});
  const [salvando, setSalvando] = useState(false);
  const [concluido, setConcluido] = useState(false);

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

  // Link sem desafio (cadastro sem CPF/nascimento/COREN): abre direto.
  useEffect(() => {
    if (link?.desafio === 'NENHUM' && !f) void confirmar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  async function confirmar() {
    setValidando(true);
    try {
      const r = await validarDesafio(token, {
        cpf: cpf.replace(/\D/g, '') || undefined,
        dataNascimento: nascimento || undefined,
        coren: coren || undefined,
      });
      setF(r.filiado);
      setTravadoOriginal({
        cpf: r.filiado.cpf, rg: r.filiado.rg, ufRg: r.filiado.ufRg,
        dataNascimento: r.filiado.dataNascimento, naturalidade: r.filiado.naturalidade,
      });
      setFotoPreview(r.filiado.fotoUrl ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setValidando(false);
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
    try {
      // A foto vai primeiro: o envio abaixo queima o link.
      if (foto) await enviarFotoRecadastro(token, foto);

      await enviarRecadastro(token, {
        // Confirmação repetida — o servidor revalida antes de gravar.
        cpfConfirmacao: cpf.replace(/\D/g, '') || undefined,
        dataNascimentoConfirmacao: nascimento || undefined,
        corenConfirmacao: coren || undefined,
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
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Abrindo seu link…
        </div>
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
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-brand-600" />
          <h1 className="text-lg font-bold">Cadastro atualizado!</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Obrigado, {link?.primeiroNome}. Seus dados foram enviados ao {tenant.sigla} e serão
            conferidos pela equipe.
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Este link já foi utilizado e não pode ser aberto novamente.
          </p>
        </div>
      </Moldura>
    );
  }

  // ------------------------------------------------------------- 1) desafio

  if (!f) {
    const pedeCoren = link?.desafio === 'COREN';
    return (
      <Moldura>
        <div className="mx-auto max-w-sm space-y-5 py-6">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/30">
              <Lock className="h-6 w-6 text-brand-800 dark:text-brand-400" />
            </div>
            <h1 className="text-lg font-bold">Olá, {link?.primeiroNome}!</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Para sua segurança, confirme {pedeCoren ? 'o número do seu COREN' : 'seus dados'} antes
              de atualizar o cadastro.
            </p>
          </div>

          {pedeCoren ? (
            <Campo label="Número do COREN" dica="Como está no seu registro profissional.">
              <Input className={campo} value={coren} onChange={(e) => setCoren(e.target.value)} placeholder="COREN-PI 000000-ENF" />
            </Campo>
          ) : (
            <>
              <Campo label="CPF">
                <Input className={campo} inputMode="numeric" value={cpf} onChange={(e) => setCpf(mascaraCpf(e.target.value))} placeholder="000.000.000-00" />
              </Campo>
              <Campo label="Data de nascimento">
                <Input className={campo} type="date" {...LIMITES_NASCIMENTO} value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
              </Campo>
            </>
          )}

          <Button className="w-full" onClick={confirmar} disabled={validando}>
            {validando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Confirmar e continuar
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Após algumas tentativas incorretas o link é bloqueado por segurança.
          </p>
        </div>
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
            <Campo label="Número do COREN" dica="Formato: COREN-PI 000000-ENF">
              <Input className={campo} value={f.numeroCoren ?? ''} onChange={(e) => set('numeroCoren', e.target.value)} />
            </Campo>
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

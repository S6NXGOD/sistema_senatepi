'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, X, UserCog, Save, Lock, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  atualizacaoCadastralFiliado, TIPOS_DEPENDENTE,
  type DependenteFiliado, type Filiado,
} from '@/lib/filiados';
import { travado, AVISO_TRAVADO, AVISO_VAZIO_LIBERADO, type CampoImutavel } from '@/lib/campos-imutaveis';

const sel = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
const SEXOS = ['MASCULINO', 'FEMININO', 'OUTRO'];
const ESTADOS_CIVIS = ['SOLTEIRO', 'CASADO', 'DIVORCIADO', 'VIUVO', 'UNIAO_ESTAVEL', 'OUTRO'];
const FORMACOES = ['ENFERMEIRO', 'TECNICO_ENFERMAGEM', 'AUXILIAR_ENFERMAGEM', 'OUTRO'];
const ROTULO: Record<string, string> = {
  MASCULINO: 'Masculino', FEMININO: 'Feminino', OUTRO: 'Outro',
  SOLTEIRO: 'Solteiro(a)', CASADO: 'Casado(a)', DIVORCIADO: 'Divorciado(a)',
  VIUVO: 'Viúvo(a)', UNIAO_ESTAVEL: 'União estável',
  ENFERMEIRO: 'Enfermeiro(a)', TECNICO_ENFERMAGEM: 'Técnico(a) de Enfermagem',
  AUXILIAR_ENFERMAGEM: 'Auxiliar de Enfermagem',
};

function Campo({
  label, children, className, bloqueado, liberado,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  /** Campo imutável já preenchido: mostra o cadeado e explica. */
  bloqueado?: boolean;
  /** Campo imutável VAZIO: pode ser preenchido, e a tela avisa. */
  liberado?: boolean;
}) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {bloqueado && <Lock className="h-3 w-3" />}
      </label>
      {children}
      {bloqueado && <p className="text-[10px] leading-tight text-muted-foreground">{AVISO_TRAVADO}</p>}
      {liberado && (
        <p className="text-[10px] leading-tight text-senatepi-700 dark:text-senatepi-400">
          {AVISO_VAZIO_LIBERADO}
        </p>
      )}
    </div>
  );
}

type Form = Record<string, string>;

/**
 * Atualização cadastral — o MESMO alcance do recadastramento, aberto por cima
 * do atendimento.
 *
 * Antes só editava contato e endereço, o que obrigava a equipe a sair do
 * atendimento e ir à ficha para corrigir qualquer outra coisa. Agora cobre
 * todos os dados que o filiado pode atualizar; CPF, RG, nascimento e
 * naturalidade aparecem travados quando já preenchidos (a trava real é do
 * servidor — ver campos-imutaveis.ts).
 */
export function AtualizacaoCadastralModal({
  filiado, onClose, onSaved,
}: {
  filiado: { id: string; nomeCompleto: string };
  onClose: () => void;
  onSaved?: () => void;
}) {
  // Busca o cadastro COMPLETO: o objeto do atendimento traz só o contato.
  const { data: completo, isLoading } = useQuery({
    queryKey: ['filiado', filiado.id],
    queryFn: async () => (await api.get(`/filiados/${filiado.id}`)).data as Filiado,
  });

  const [form, setForm] = useState<Form | null>(null);
  const [vinculos, setVinculos] = useState<Array<{ empresa: string; cargo?: string; matricula?: string }>>([]);
  const [dependentes, setDependentes] = useState<DependenteFiliado[]>([]);

  // Preenche o formulário na primeira vez que o cadastro chega.
  if (completo && form === null) {
    setForm({
      nomeCompleto: completo.nomeCompleto ?? '',
      cpf: completo.cpf ?? '',
      rg: completo.rg ?? '',
      ufRg: completo.ufRg ?? '',
      dataNascimento: completo.dataNascimento?.slice(0, 10) ?? '',
      sexo: completo.sexo ?? '',
      estadoCivil: completo.estadoCivil ?? '',
      naturalidade: completo.naturalidade ?? '',
      telefonePrincipal: completo.telefonePrincipal ?? '',
      telefoneSecundario: completo.telefoneSecundario ?? '',
      email: completo.email ?? '',
      cep: completo.cep ?? '',
      endereco: completo.endereco ?? '',
      numero: completo.numero ?? '',
      complemento: completo.complemento ?? '',
      bairro: completo.bairro ?? '',
      cidade: completo.cidade ?? '',
      estado: completo.estado ?? '',
      formacao: completo.formacao ?? '',
      formacaoOutro: completo.formacaoOutro ?? '',
      numeroCoren: completo.numeroCoren ?? '',
      dataAdmissao: completo.dataAdmissao?.slice(0, 10) ?? '',
    });
    setVinculos(
      (completo.vinculos ?? []).map((v) => ({
        empresa: v.empresa ?? '', cargo: v.cargo ?? '', matricula: v.matricula ?? '',
      })),
    );
    setDependentes(
      (completo.dependentes ?? []).map((d) => ({
        id: d.id, tipo: d.tipo, nome: d.nome, cpf: d.cpf ?? '',
        dataNascimento: d.dataNascimento?.slice(0, 10) ?? '',
      })),
    );
  }

  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const bloq = (campo: CampoImutavel) => travado(campo, (completo as never)?.[campo]);

  const salvar = useMutation({
    mutationFn: () => {
      const f = form!;
      const so = (v: string) => v.trim() || undefined;
      return atualizacaoCadastralFiliado(filiado.id, {
        nomeCompleto: so(f.nomeCompleto),
        // Campos travados nem são enviados; os vazios seguem para preencher.
        ...(bloq('cpf') ? {} : { cpf: so(f.cpf)?.replace(/\D/g, '') }),
        ...(bloq('rg') ? {} : { rg: so(f.rg) }),
        ...(bloq('ufRg') ? {} : { ufRg: so(f.ufRg) }),
        ...(bloq('dataNascimento') ? {} : { dataNascimento: so(f.dataNascimento) }),
        ...(bloq('naturalidade') ? {} : { naturalidade: so(f.naturalidade) }),
        sexo: so(f.sexo), estadoCivil: so(f.estadoCivil),
        telefonePrincipal: so(f.telefonePrincipal), telefoneSecundario: so(f.telefoneSecundario),
        email: so(f.email), cep: so(f.cep), endereco: so(f.endereco), numero: so(f.numero),
        complemento: so(f.complemento), bairro: so(f.bairro), cidade: so(f.cidade),
        estado: so(f.estado), formacao: so(f.formacao),
        formacaoOutro: f.formacao === 'OUTRO' ? so(f.formacaoOutro) : undefined,
        numeroCoren: so(f.numeroCoren), dataAdmissao: so(f.dataAdmissao),
        vinculos: vinculos.filter((v) => v.empresa?.trim()).map((v, i) => ({
          empresa: v.empresa.trim(), cargo: v.cargo?.trim() || undefined,
          matricula: v.matricula?.trim() || undefined, ordem: i + 1,
        })),
        dependentes: dependentes.filter((d) => d.nome?.trim() && d.dataNascimento).map((d) => ({
          id: d.id, tipo: d.tipo, nome: d.nome.trim(),
          cpf: d.cpf?.replace(/\D/g, '') || undefined,
          dataNascimento: d.dataNascimento.slice(0, 10),
        })),
      });
    },
    onSuccess: (r) => {
      toast.success('Cadastro atualizado!', { description: filiado.nomeCompleto });
      if (r?.camposProtegidos?.length) {
        toast.info(`Não alterados (dados fixos): ${r.camposProtegidos.join(', ')}.`);
      }
      onSaved?.();
      onClose();
    },
    onError: (e: any) =>
      toast.error('Não foi possível salvar', {
        description: e?.response?.data?.message ?? 'Tente novamente.',
      }),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvar.isPending ? undefined : onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-senatepi-50 p-2 dark:bg-senatepi-900/30">
              <UserCog className="h-6 w-6 text-senatepi-700 dark:text-senatepi-400" />
            </div>
            <div>
              <h3 className="font-semibold leading-tight">Atualização cadastral</h3>
              <p className="text-xs text-muted-foreground">{filiado.nomeCompleto}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={salvar.isPending} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading || !form ? (
          <div className="flex items-center justify-center gap-2 p-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Carregando o cadastro…
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <Secao titulo="Dados pessoais">
              <Campo label="Nome completo">
                <Input value={form.nomeCompleto} onChange={(e) => set('nomeCompleto', e.target.value)} />
              </Campo>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Campo label="CPF" bloqueado={bloq('cpf')} liberado={!bloq('cpf')}>
                  <Input readOnly={bloq('cpf')} className={bloq('cpf') ? 'bg-muted' : ''} inputMode="numeric" value={form.cpf} onChange={(e) => set('cpf', e.target.value)} />
                </Campo>
                <Campo label="RG" bloqueado={bloq('rg')} liberado={!bloq('rg')}>
                  <Input readOnly={bloq('rg')} className={bloq('rg') ? 'bg-muted' : ''} value={form.rg} onChange={(e) => set('rg', e.target.value)} />
                </Campo>
                <Campo label="UF do RG" bloqueado={bloq('ufRg')}>
                  <Input readOnly={bloq('ufRg')} className={bloq('ufRg') ? 'bg-muted' : ''} maxLength={2} value={form.ufRg} onChange={(e) => set('ufRg', e.target.value.toUpperCase())} />
                </Campo>
                <Campo label="Data de nascimento" bloqueado={bloq('dataNascimento')} liberado={!bloq('dataNascimento')}>
                  <Input readOnly={bloq('dataNascimento')} className={bloq('dataNascimento') ? 'bg-muted' : ''} type="date" value={form.dataNascimento} onChange={(e) => set('dataNascimento', e.target.value)} />
                </Campo>
                <Campo label="Naturalidade" bloqueado={bloq('naturalidade')}>
                  <Input readOnly={bloq('naturalidade')} className={bloq('naturalidade') ? 'bg-muted' : ''} value={form.naturalidade} onChange={(e) => set('naturalidade', e.target.value)} />
                </Campo>
                <Campo label="Sexo">
                  <select className={sel} value={form.sexo} onChange={(e) => set('sexo', e.target.value)}>
                    <option value="">Não informar</option>
                    {SEXOS.map((s) => <option key={s} value={s}>{ROTULO[s] ?? s}</option>)}
                  </select>
                </Campo>
                <Campo label="Estado civil">
                  <select className={sel} value={form.estadoCivil} onChange={(e) => set('estadoCivil', e.target.value)}>
                    <option value="">Não informar</option>
                    {ESTADOS_CIVIS.map((s) => <option key={s} value={s}>{ROTULO[s] ?? s}</option>)}
                  </select>
                </Campo>
              </div>
            </Secao>

            <Secao titulo="Contato">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Telefone principal"><Input inputMode="tel" value={form.telefonePrincipal} onChange={(e) => set('telefonePrincipal', e.target.value)} /></Campo>
                <Campo label="Telefone secundário"><Input inputMode="tel" value={form.telefoneSecundario} onChange={(e) => set('telefoneSecundario', e.target.value)} /></Campo>
              </div>
              <Campo label="E-mail"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Campo>
            </Secao>

            <Secao titulo="Endereço">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                <Campo label="CEP" className="col-span-2"><Input inputMode="numeric" value={form.cep} onChange={(e) => set('cep', e.target.value)} /></Campo>
                <Campo label="Logradouro" className="col-span-4"><Input value={form.endereco} onChange={(e) => set('endereco', e.target.value)} /></Campo>
                <Campo label="Número" className="col-span-2"><Input value={form.numero} onChange={(e) => set('numero', e.target.value)} /></Campo>
                <Campo label="Complemento" className="col-span-4"><Input value={form.complemento} onChange={(e) => set('complemento', e.target.value)} /></Campo>
                <Campo label="Bairro" className="col-span-3"><Input value={form.bairro} onChange={(e) => set('bairro', e.target.value)} /></Campo>
                <Campo label="Cidade" className="col-span-2"><Input value={form.cidade} onChange={(e) => set('cidade', e.target.value)} /></Campo>
                <Campo label="UF" className="col-span-1"><Input maxLength={2} value={form.estado} onChange={(e) => set('estado', e.target.value.toUpperCase())} /></Campo>
              </div>
            </Secao>

            <Secao titulo="Dados profissionais">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Campo label="Formação">
                  <select className={sel} value={form.formacao} onChange={(e) => set('formacao', e.target.value)}>
                    <option value="">Não informar</option>
                    {FORMACOES.map((s) => <option key={s} value={s}>{ROTULO[s] ?? s}</option>)}
                  </select>
                </Campo>
                <Campo label="Número do COREN"><Input value={form.numeroCoren} onChange={(e) => set('numeroCoren', e.target.value)} /></Campo>
                <Campo label="Data de admissão"><Input type="date" value={form.dataAdmissao} onChange={(e) => set('dataAdmissao', e.target.value)} /></Campo>
              </div>
              {form.formacao === 'OUTRO' && (
                <Campo label="Qual formação?"><Input value={form.formacaoOutro} onChange={(e) => set('formacaoOutro', e.target.value)} /></Campo>
              )}
            </Secao>

            <Secao titulo="Vínculos de trabalho">
              {vinculos.map((v, i) => (
                <div key={i} className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase text-muted-foreground">Vínculo {i + 1}</span>
                    <button type="button" onClick={() => setVinculos((l) => l.filter((_, j) => j !== i))} className="flex items-center gap-1 text-xs text-red-600 hover:underline dark:text-red-400">
                      <Trash2 className="h-3 w-3" /> Remover
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Campo label="Instituição/Empresa"><Input value={v.empresa} onChange={(e) => setVinculos((l) => l.map((x, j) => j === i ? { ...x, empresa: e.target.value } : x))} /></Campo>
                    <Campo label="Cargo"><Input value={v.cargo ?? ''} onChange={(e) => setVinculos((l) => l.map((x, j) => j === i ? { ...x, cargo: e.target.value } : x))} /></Campo>
                    <Campo label="Matrícula"><Input value={v.matricula ?? ''} onChange={(e) => setVinculos((l) => l.map((x, j) => j === i ? { ...x, matricula: e.target.value } : x))} /></Campo>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setVinculos((l) => [...l, { empresa: '', cargo: '', matricula: '' }])}>
                <Plus className="h-4 w-4" /> Adicionar vínculo
              </Button>
            </Secao>

            <Secao titulo="Dependentes">
              {dependentes.map((d, i) => (
                <div key={d.id ?? `novo-${i}`} className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase text-muted-foreground">Dependente {i + 1}</span>
                    <button type="button" onClick={() => setDependentes((l) => l.filter((_, j) => j !== i))} className="flex items-center gap-1 text-xs text-red-600 hover:underline dark:text-red-400">
                      <Trash2 className="h-3 w-3" /> Remover
                    </button>
                  </div>
                  <Campo label="Nome completo"><Input value={d.nome} onChange={(e) => setDependentes((l) => l.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))} /></Campo>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Campo label="Parentesco">
                      <select className={sel} value={d.tipo} onChange={(e) => setDependentes((l) => l.map((x, j) => j === i ? { ...x, tipo: e.target.value as DependenteFiliado['tipo'] } : x))}>
                        {TIPOS_DEPENDENTE.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                      </select>
                    </Campo>
                    <Campo label="Data de nascimento"><Input type="date" value={d.dataNascimento?.slice(0, 10) ?? ''} onChange={(e) => setDependentes((l) => l.map((x, j) => j === i ? { ...x, dataNascimento: e.target.value } : x))} /></Campo>
                    <Campo label="CPF"><Input value={d.cpf ?? ''} onChange={(e) => setDependentes((l) => l.map((x, j) => j === i ? { ...x, cpf: e.target.value } : x))} /></Campo>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setDependentes((l) => [...l, { tipo: 'FILHO', nome: '', cpf: '', dataNascimento: '' }])}>
                <Plus className="h-4 w-4" /> Adicionar dependente
              </Button>
            </Secao>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !form}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar cadastro
          </Button>
        </div>
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      {children}
    </section>
  );
}

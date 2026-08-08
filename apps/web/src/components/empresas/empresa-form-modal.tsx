'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, Search, Building2, CheckCircle2, AlertTriangle, KeyRound,
  Eye, EyeOff, Wand2, Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  consultarCnpj, criarEmpresa, cnpjValido, mascaraCnpj, mascaraCep, apenasDigitos,
  gerarSenhaProvisoria, type DadosCnpj,
} from '@/lib/empresas';

const VAZIO = {
  razaoSocial: '', nomeFantasia: '', cep: '', logradouro: '',
  bairro: '', cidade: '', uf: '',
};

/** Estado da consulta à Receita — governa o aviso mostrado abaixo do campo. */
type EstadoBusca =
  | { tipo: 'ocioso' }
  | { tipo: 'buscando' }
  | { tipo: 'ok'; dados: DadosCnpj }
  | { tipo: 'erro'; mensagem: string };

/**
 * Cadastro de empresa do Módulo Patronal.
 *
 * O CNPJ dispara a consulta à Receita (BrasilAPI) assim que os 14 dígitos são
 * digitados e os dígitos verificadores fecham. A consulta é uma CONVENIÊNCIA:
 * se ela falhar, os campos continuam editáveis e o cadastro pode ser concluído
 * à mão — o serviço externo não pode ser um bloqueio para a secretaria.
 */
export function EmpresaFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [cnpj, setCnpj] = useState('');
  const [form, setForm] = useState(VAZIO);
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [busca, setBusca] = useState<EstadoBusca>({ tipo: 'ocioso' });

  // Evita consultar de novo o mesmo número (ex.: ao reeditar a máscara).
  const ultimoConsultado = useRef<string>('');

  function fechar() {
    setCnpj(''); setForm(VAZIO); setSenha(''); setVerSenha(false);
    setBusca({ tipo: 'ocioso' }); ultimoConsultado.current = '';
    onClose();
  }

  const set = (campo: keyof typeof VAZIO, valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  // ------------------------------------------------------------ consulta CNPJ

  async function buscar(digitos: string) {
    ultimoConsultado.current = digitos;
    setBusca({ tipo: 'buscando' });
    try {
      const dados = await consultarCnpj(digitos);
      setBusca({ tipo: 'ok', dados });
      // Preenche o que veio, preservando o que a secretaria já tiver digitado.
      setForm((f) => ({
        razaoSocial: dados.razaoSocial || f.razaoSocial,
        nomeFantasia: dados.nomeFantasia ?? f.nomeFantasia,
        cep: dados.cep ? mascaraCep(dados.cep) : f.cep,
        logradouro: montarLogradouro(dados) || f.logradouro,
        bairro: dados.bairro ?? f.bairro,
        cidade: dados.cidade ?? f.cidade,
        uf: dados.uf ?? f.uf,
      }));
    } catch (e: any) {
      const mensagem =
        e?.response?.data?.message ??
        'Não foi possível consultar o CNPJ. Preencha os dados manualmente.';
      setBusca({ tipo: 'erro', mensagem: Array.isArray(mensagem) ? mensagem[0] : mensagem });
    }
  }

  // Dispara sozinho quando o número fica completo e válido.
  useEffect(() => {
    const d = apenasDigitos(cnpj);
    if (d.length < 14) {
      if (busca.tipo !== 'ocioso') setBusca({ tipo: 'ocioso' });
      ultimoConsultado.current = '';
      return;
    }
    if (!cnpjValido(d)) {
      setBusca({ tipo: 'erro', mensagem: 'CNPJ inválido — confira os números digitados.' });
      return;
    }
    if (d === ultimoConsultado.current) return;
    void buscar(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpj]);

  // ------------------------------------------------------------------ salvar

  const salvar = useMutation({
    mutationFn: () =>
      criarEmpresa({
        cnpj: apenasDigitos(cnpj),
        razaoSocial: form.razaoSocial.trim(),
        nomeFantasia: form.nomeFantasia.trim() || undefined,
        cep: apenasDigitos(form.cep) || undefined,
        logradouro: form.logradouro.trim() || undefined,
        bairro: form.bairro.trim() || undefined,
        cidade: form.cidade.trim() || undefined,
        uf: form.uf.trim().toUpperCase() || undefined,
        senhaProvisoria: senha,
      }),
    onSuccess: (e) => {
      toast.success(`${e.razaoSocial} cadastrada.`);
      void qc.invalidateQueries({ queryKey: ['empresas'] });
      fechar();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível cadastrar a empresa.');
    },
  });

  function enviar() {
    if (!cnpjValido(cnpj)) return toast.error('Informe um CNPJ válido.');
    if (form.razaoSocial.trim().length < 2) return toast.error('Informe a razão social.');
    if (senha.length < 6) return toast.error('A senha provisória precisa de ao menos 6 caracteres.');
    salvar.mutate();
  }

  if (!open) return null;

  const duplicada = busca.tipo === 'ok' && busca.dados.jaCadastrada;
  const inativa =
    busca.tipo === 'ok' && !!busca.dados.situacao && busca.dados.situacao !== 'ATIVA';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={fechar}>
      <div
        className="my-8 w-full max-w-2xl rounded-2xl bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b p-5">
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <Building2 className="h-5 w-5 text-brand-800 dark:text-brand-400" />
              Nova empresa
            </h3>
            <p className="text-xs text-muted-foreground">
              Digite o CNPJ — os dados vêm da Receita automaticamente.
            </p>
          </div>
          <button type="button" onClick={fechar} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* ------------------------------------------------------------ CNPJ */}
          <Campo label="CNPJ *">
            <div className="relative">
              <Input
                autoFocus
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={(e) => setCnpj(mascaraCnpj(e.target.value))}
                className="pr-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {busca.tipo === 'buscando' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : busca.tipo === 'ok' ? (
                  <CheckCircle2 className="h-4 w-4 text-brand-600" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </span>
            </div>

            {busca.tipo === 'buscando' && (
              <p className="text-xs text-muted-foreground">Consultando a Receita Federal…</p>
            )}

            {busca.tipo === 'erro' && (
              <Aviso tom="amarelo">
                {busca.mensagem} Você pode preencher os campos abaixo manualmente.
                {apenasDigitos(cnpj).length === 14 && cnpjValido(cnpj) && (
                  <button
                    type="button"
                    onClick={() => void buscar(apenasDigitos(cnpj))}
                    className="ml-1 font-semibold underline"
                  >
                    Tentar de novo
                  </button>
                )}
              </Aviso>
            )}

            {duplicada && (
              <Aviso tom="vermelho">
                Este CNPJ já está cadastrado no sistema. Procure a empresa na listagem.
              </Aviso>
            )}

            {busca.tipo === 'ok' && !duplicada && inativa && (
              <Aviso tom="amarelo">
                Situação cadastral na Receita: <strong>{busca.dados.situacao}</strong>. Confirme
                antes de conveniar.
              </Aviso>
            )}
          </Campo>

          {/* ------------------------------------------------------- Cadastrais */}
          <Secao titulo="Dados da empresa">
            <Campo label="Razão social *">
              <Input value={form.razaoSocial} onChange={(e) => set('razaoSocial', e.target.value)} />
            </Campo>
            <Campo label="Nome fantasia">
              <Input value={form.nomeFantasia} onChange={(e) => set('nomeFantasia', e.target.value)} />
            </Campo>
          </Secao>

          <Secao titulo="Endereço">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Campo label="CEP">
                <Input inputMode="numeric" value={form.cep} onChange={(e) => set('cep', mascaraCep(e.target.value))} placeholder="00000-000" />
              </Campo>
              <div className="sm:col-span-2">
                <Campo label="Logradouro">
                  <Input value={form.logradouro} onChange={(e) => set('logradouro', e.target.value)} />
                </Campo>
              </div>
              <Campo label="Bairro">
                <Input value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
              </Campo>
              <Campo label="Cidade">
                <Input value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
              </Campo>
              <Campo label="UF">
                <Input maxLength={2} value={form.uf} onChange={(e) => set('uf', e.target.value.toUpperCase())} />
              </Campo>
            </div>
          </Secao>

          {/* ---------------------------------------------------------- Acesso */}
          <Secao titulo="Acesso ao portal">
            <Campo label="Senha provisória *">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={verSenha ? 'text' : 'password'}
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="Mínimo de 6 caracteres"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setVerSenha((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={verSenha ? 'Ocultar' : 'Mostrar'}
                  >
                    {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setSenha(gerarSenhaProvisoria()); setVerSenha(true); }}
                >
                  <Wand2 className="h-4 w-4" /> Gerar
                </Button>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Entregue esta senha à empresa. Ela será obrigada a trocá-la no primeiro acesso —
                depois de salvar, a senha não pode ser consultada de novo.
              </p>
            </Campo>
          </Secao>
        </div>

        <div className="flex justify-end gap-2 border-t p-5">
          <Button variant="outline" onClick={fechar} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={enviar} disabled={salvar.isPending || duplicada}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Cadastrar empresa
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Junta logradouro + número + complemento, que a Receita devolve separados. */
function montarLogradouro(d: DadosCnpj): string {
  return [d.logradouro, d.numero, d.complemento].filter(Boolean).join(', ');
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      {children}
    </section>
  );
}

function Aviso({ tom, children }: { tom: 'amarelo' | 'vermelho'; children: React.ReactNode }) {
  const cores =
    tom === 'vermelho'
      ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300';
  return (
    <p className={`flex items-start gap-1.5 rounded-md border px-2.5 py-2 text-xs ${cores}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

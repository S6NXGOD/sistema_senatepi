'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Save, KeyRound, FileText, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getConfig, salvarConfig, ConfiguracaoSindicato } from '@/lib/cobrancas';

type FormConfig = {
  pixChave: string;
  pixNomeRecebedor: string;
  pixCidade: string;
  textoRodapeCarne: string;
  logoUrl: string;
  assinaturaPresidenteUrl: string;
};

const VAZIO: FormConfig = {
  pixChave: '', pixNomeRecebedor: '', pixCidade: '',
  textoRodapeCarne: '', logoUrl: '', assinaturaPresidenteUrl: '',
};

/**
 * Campo de formulário. IMPORTANTE: definido em ESCOPO DE MÓDULO (fora do
 * componente de página) — se ficasse dentro, seria recriado a cada render e
 * os inputs perderiam o foco a cada tecla ("digita uma letra por vez").
 */
function Campo({ label, children, dica }: { label: string; children: React.ReactNode; dica?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

export default function ConfiguracaoCobrancasPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['cobrancas-config'], queryFn: getConfig });
  const [form, setForm] = useState<FormConfig>(VAZIO);
  const [salvoOk, setSalvoOk] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        pixChave: data.pixChave ?? '',
        pixNomeRecebedor: data.pixNomeRecebedor ?? '',
        pixCidade: data.pixCidade ?? '',
        textoRodapeCarne: data.textoRodapeCarne ?? '',
        logoUrl: data.logoUrl ?? '',
        assinaturaPresidenteUrl: data.assinaturaPresidenteUrl ?? '',
      });
    }
  }, [data]);

  const set = (k: keyof FormConfig, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const salvar = useMutation({
    // Envia SÓ os campos permitidos (o back rejeita props extras — LGPD/whitelist).
    mutationFn: () => {
      const dto: ConfiguracaoSindicato = {
        pixChave: form.pixChave.trim() || null,
        pixNomeRecebedor: form.pixNomeRecebedor.trim() || null,
        pixCidade: form.pixCidade.trim() || null,
        textoRodapeCarne: form.textoRodapeCarne.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        assinaturaPresidenteUrl: form.assinaturaPresidenteUrl.trim() || null,
      };
      return salvarConfig(dto);
    },
    onSuccess: () => {
      toast.success('Configuração salva com sucesso!', {
        description: form.pixChave.trim()
          ? 'A chave PIX foi definida — já é possível gerar carnês.'
          : 'Preencha a chave PIX para habilitar a geração de carnês.',
      });
      qc.invalidateQueries({ queryKey: ['cobrancas-config'] });
      setSalvoOk(true);
      setTimeout(() => setSalvoOk(false), 4000);
    },
    onError: (e: any) => toast.error('Não foi possível salvar', { description: e?.response?.data?.message ?? 'Tente novamente em instantes.' }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/cobrancas"><Button variant="ghost" size="icon" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></Button></Link>
        <div>
          <h2 className="text-2xl font-bold">Configuração do sindicato</h2>
          <p className="text-sm text-muted-foreground">Dados usados nos carnês e no PIX</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>
      ) : (
        <>
          {/* PIX */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> PIX (recebedor)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Campo label="Chave PIX *" dica="CPF/CNPJ, e-mail, telefone ou chave aleatória. Obrigatória para gerar o carnê.">
                <Input placeholder="ex.: financeiro@senatepi.org.br" value={form.pixChave} onChange={(e) => set('pixChave', e.target.value)} />
              </Campo>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Campo label="Nome do recebedor" dica="Aparece no QR (máx. 25 caracteres).">
                  <Input maxLength={25} placeholder="SINDICATO SENATEPI" value={form.pixNomeRecebedor} onChange={(e) => set('pixNomeRecebedor', e.target.value)} />
                </Campo>
                <Campo label="Cidade do recebedor" dica="Aparece no QR (máx. 15 caracteres).">
                  <Input maxLength={15} placeholder="TERESINA" value={form.pixCidade} onChange={(e) => set('pixCidade', e.target.value)} />
                </Campo>
              </div>
            </CardContent>
          </Card>

          {/* Carnê */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Carnê</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Campo label="Texto de rodapé do carnê" dica="Texto de responsabilidade impresso no carnê (a menção à LGPD é adicionada automaticamente).">
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm"
                  placeholder="Pagamento referente à contribuição associativa…"
                  value={form.textoRodapeCarne}
                  onChange={(e) => set('textoRodapeCarne', e.target.value)}
                />
              </Campo>
              <Campo label="URL da logomarca" dica="Endereço da imagem da logo (ex.: /lc.png ou uma imagem hospedada).">
                <Input placeholder="/logo-sindicato.png" value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} />
              </Campo>
              <Campo label="URL da assinatura do presidente" dica="Endereço da imagem da assinatura (fundo transparente de preferência).">
                <Input placeholder="/assinatura-presidente.png" value={form.assinaturaPresidenteUrl} onChange={(e) => set('assinaturaPresidenteUrl', e.target.value)} />
              </Campo>
              {(form.logoUrl || form.assinaturaPresidenteUrl) && (
                <div className="flex flex-wrap items-center gap-6 rounded-lg border bg-muted/30 p-3">
                  {form.logoUrl && (
                    <div className="text-center">
                      <p className="mb-1 text-xs text-muted-foreground">Logo</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.logoUrl} alt="" className="h-10 object-contain" />
                    </div>
                  )}
                  {form.assinaturaPresidenteUrl && (
                    <div className="text-center">
                      <p className="mb-1 text-xs text-muted-foreground">Assinatura</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.assinaturaPresidenteUrl} alt="" className="h-10 object-contain" />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {salvoOk && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-senatepi-700 dark:text-senatepi-400">
                <CheckCircle2 className="h-4 w-4" /> Configuração salva
              </span>
            )}
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar configuração
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

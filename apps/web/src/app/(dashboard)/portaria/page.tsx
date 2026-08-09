'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, ScanLine, Loader2, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  listarAcessos, validarAcesso, ORIGEM_ACESSO_LABEL,
  type RegistroAcesso, type ResultadoAcesso,
} from '@/lib/acessos';

/**
 * PORTARIA DO CLUBE.
 *
 * O caminho normal do sindicato: a pessoa chega ao clube e a portaria confere se
 * pode entrar. Validação de EVENTO é outra tela (`/validacao`), porque é a
 * exceção — e misturar as duas faria a portaria pedir um evento que não existe.
 *
 * O CAMPO ACEITA AS TRÊS COISAS num input só: leitor de QR (que digita e dá
 * Enter), matrícula e CPF. Obrigar a escolher o tipo antes seria um clique a
 * mais em cada entrada, na tela que mais se usa por dia.
 */
export default function PortariaPage() {
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState<ResultadoAcesso | null>(null);
  const [validando, setValidando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  const historico = useQuery({
    queryKey: ['acessos-hoje'],
    queryFn: () => listarAcessos(),
    refetchInterval: 30_000,
  });

  /** O foco volta para o campo depois de cada leitura — a fila não espera. */
  useEffect(() => { campo.current?.focus(); }, [resultado]);

  async function validar() {
    const valor = texto.trim();
    if (!valor || validando) return;
    setValidando(true);
    try {
      /**
       * O leitor de QR digita o JSON inteiro. Se o texto for um objeto válido,
       * vai como QR (com assinatura conferida); senão, como identificador.
       */
      let payload: unknown = null;
      try {
        const lido = JSON.parse(valor);
        if (lido && typeof lido === 'object' && 'id' in lido && 'validacao' in lido) payload = lido;
      } catch { /* não é JSON: é matrícula ou CPF */ }

      setResultado(
        await validarAcesso(payload ? { qr: payload } : { identificador: valor }),
      );
      setTexto('');
      historico.refetch();
    } catch (e: any) {
      setResultado({
        encontrado: false,
        liberado: false,
        motivo: e?.response?.data?.message ?? 'Não foi possível validar agora.',
      });
    } finally {
      setValidando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
          <ScanLine className="h-5 w-5 text-brand-800 dark:text-brand-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Portaria</h2>
          <p className="text-sm text-muted-foreground">
            Entrada no clube · carteirinha, matrícula ou CPF
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <Input
            ref={campo}
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); validar(); } }}
            placeholder="Aproxime a carteirinha ou digite a matrícula / CPF"
            className="h-14 text-lg"
          />
          <Button onClick={validar} disabled={!texto.trim() || validando} className="w-full">
            {validando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            Validar entrada
          </Button>
        </CardContent>
      </Card>

      {/* RESULTADO — grande e colorido: quem está na portaria decide em um
          olhar, muitas vezes de longe e com fila esperando. */}
      {resultado && (
        <Card
          className={cn(
            'border-2',
            resultado.liberado
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
              : 'border-red-500 bg-red-50 dark:bg-red-950/20',
          )}
        >
          <CardContent className="flex items-center gap-4 py-6">
            {resultado.liberado
              ? <CheckCircle2 className="h-14 w-14 shrink-0 text-emerald-600" />
              : <XCircle className="h-14 w-14 shrink-0 text-red-600" />}
            {resultado.fotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resultado.fotoUrl} alt="" className="h-20 w-20 shrink-0 rounded-full border-2 border-white object-cover shadow" />
            )}
            <div className="min-w-0">
              <p className={cn(
                'text-2xl font-bold',
                resultado.liberado ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300',
              )}>
                {resultado.liberado ? 'ENTRADA LIBERADA' : 'ENTRADA NEGADA'}
              </p>
              {resultado.nome && <p className="truncate text-lg font-medium">{resultado.nome}</p>}
              <p className="text-sm text-muted-foreground">{resultado.motivo}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Entradas de hoje
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historico.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !historico.data?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma entrada registrada hoje.</p>
          ) : (
            <ul className="divide-y">
              {historico.data.map((r: RegistroAcesso) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.nomeSnapshot}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {new Date(r.registradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}{ORIGEM_ACESSO_LABEL[r.origem]}
                      {!r.liberado && ` · ${r.motivo}`}
                    </span>
                  </span>
                  <span className={cn(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    r.liberado
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
                  )}>
                    {r.liberado ? 'liberado' : 'negado'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

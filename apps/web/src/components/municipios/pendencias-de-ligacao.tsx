'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Building2, Check, ChevronDown, Link2, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SeletorDeEnte } from '@/components/municipios/seletor-de-ente';
import {
  ligarCidade,
  ligarOrganizacao,
  numeroBR,
  type EnteResumido,
  type Pendencias,
  type SugestaoDeMunicipio,
} from '@/lib/municipios';

/**
 * "AJUDE A CONTAR CERTO" — o que o sistema não conseguiu ligar sozinho, com o
 * palpite ao lado e um clique para resolver.
 *
 * A faixa antiga só listava ("43 filiados com cidade que não bate: Monte
 * Alegre (20), MORRO CABEÇA DO TEMPO/PI (5)…") e parava aí. Aviso sem ação
 * ensina a ignorar o aviso. Agora cada grafia vem com o município provável, e
 * cada órgão público sem governo, com o seletor.
 *
 * FECHADA POR PADRÃO: é trabalho de manutenção, de quem pode editar, e não
 * pode empurrar a lista — que é o motivo de a tela existir — para baixo da
 * dobra no celular.
 *
 * CONFIRMAR ANTES DE GRAVAR: um toque liga vinte filiados de uma vez, e a
 * ligação manual não é desfeita pela varredura. O passo a mais custa um toque;
 * o engano custaria corrigir vinte cadastros.
 */

const MOTIVO: Record<SugestaoDeMunicipio['motivo'], string> = {
  COMECA_IGUAL: 'O nome oficial começa pelo que foi digitado',
  ESCRITA_PARECIDA: 'Uma ou duas letras de diferença',
  MESMO_NOME_EM_OUTRA_UF: 'O nome existe, mas em outro estado',
};

export function PendenciasDeLigacao({ pend, onMudou }: { pend: Pendencias; onMudou: () => void }) {
  const [aberta, setAberta] = useState(false);
  const cidades = pend.filiadosSemMunicipio.filter((c) => c.cidade);
  const orgaos = pend.orgaosSemGoverno?.itens ?? [];
  if (!pend.jaRodou || (!cidades.length && !orgaos.length)) return null;

  /* Os TOTAIS vêm do servidor: as listas têm teto (40 grafias, 12 órgãos), e somar o que cabe nelas mentiria. */
  const nFiliados = pend.totalSemMunicipio ?? cidades.reduce((a, c) => a + c.quantos, 0);
  const nOrgaos = Math.max(pend.orgaosSemGoverno?.total ?? 0, orgaos.length);
  const resumo = [
    nFiliados ? `${numeroBR(nFiliados)} ${nFiliados === 1 ? 'filiado' : 'filiados'} com cidade que o sistema não reconheceu` : '',
    nOrgaos ? `${nOrgaos} ${nOrgaos === 1 ? 'órgão público' : 'órgãos públicos'} sem governo definido` : '',
  ]
    .filter(Boolean)
    .join(' e ');

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <Link2 className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <span className="min-w-0 flex-1 text-sm">
          <strong className="font-semibold">Ajude a contar certo:</strong>{' '}
          <span className="text-muted-foreground">{resumo}.</span>
        </span>
        <span className="hidden shrink-0 text-xs font-semibold text-amber-800 dark:text-amber-300 sm:inline">
          {aberta ? 'fechar' : 'resolver'}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition', aberta && 'rotate-180')} aria-hidden />
      </button>

      {aberta && (
        <div className="space-y-5 border-t border-amber-200 px-3 pb-3 pt-3 dark:border-amber-900">
          {cidades.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Cidades escritas de um jeito que o sistema não reconheceu</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Escolha o município certo. O que está escrito no cadastro não muda — só a ligação com o
                IBGE, e ela vale para todos os filiados com a mesma grafia.
              </p>
              <ul className="mt-2 divide-y rounded-lg border bg-card">
                {cidades.map((c) => (
                  <LinhaDeCidade key={`${c.cidade}|${c.estado ?? ''}`} c={c} onFeito={onMudou} />
                ))}
              </ul>
            </div>
          )}

          {orgaos.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Órgãos públicos que não dizem de qual governo são</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Quem trabalha neles só entra em &quot;trabalham para o Estado&quot; (ou para a prefeitura)
                depois disto. O HGV, por exemplo, é do Governo do Estado.
              </p>
              <ul className="mt-2 divide-y rounded-lg border bg-card">
                {orgaos.map((o) => (
                  <LinhaDeOrgao key={o.id} o={o} onFeito={onMudou} />
                ))}
              </ul>
              {nOrgaos > orgaos.length && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Aqui estão os {orgaos.length} com mais filiados, de {nOrgaos}. Os outros se resolvem no cadastro de
                  Organizações.
                </p>
              )}
            </div>
          )}

          {pend.cobertura && pend.cobertura.ativos > 0 && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              E o que nenhum clique aqui resolve: de {numeroBR(pend.cobertura.ativos)} filiados ativos,{' '}
              {numeroBR(pend.cobertura.semCidade)} estão sem cidade no cadastro e só{' '}
              {numeroBR(pend.cobertura.comLocalDeTrabalho)} têm o local de trabalho ligado a uma
              organização. Completar esses campos na ficha do filiado faz os números desta tela crescerem.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Confirmacao({
  texto,
  salvando,
  onConfirmar,
  onCancelar,
}: {
  texto: React.ReactNode;
  salvando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/70 p-2 text-sm">
      <span className="min-w-0 flex-1">{texto}</span>
      <Button size="sm" onClick={onConfirmar} disabled={salvando}>
        {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmar
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancelar} disabled={salvando}>
        Cancelar
      </Button>
    </div>
  );
}

function LinhaDeCidade({
  c,
  onFeito,
}: {
  c: Pendencias['filiadosSemMunicipio'][number];
  onFeito: () => void;
}) {
  const [escolha, setEscolha] = useState<{ codigo: number; nome: string; uf: string } | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const grafia = `${c.cidade}${c.estado ? '/' + c.estado : ''}`;

  async function confirmar() {
    if (!escolha || !c.cidade) return;
    setSalvando(true);
    try {
      const r = await ligarCidade(c.cidade, c.estado, escolha.codigo);
      /*
        ZERO LIGADOS não é erro: outra pessoa resolveu a mesma grafia antes. A
        linha volta a ser clicável (o `finally`), e a lista se atualiza.
      */
      if (r.ligados === 0) {
        toast.info('Ninguém mais estava com essa grafia sem município — alguém já tinha ligado.');
      } else {
        toast.success(
          `${r.ligados} ${r.ligados === 1 ? 'filiado ligado' : 'filiados ligados'} a ${r.municipio.nome}/${r.municipio.uf}.`,
        );
      }
      setEscolha(null);
      onFeito();
    } catch (e) {
      toast.error((e as Error).message || 'Não foi possível ligar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <li className="space-y-2 px-3 py-2.5">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">&ldquo;{grafia}&rdquo;</span>
        <span className="text-xs text-muted-foreground">
          {c.quantos} {c.quantos === 1 ? 'filiado' : 'filiados'}
        </span>
      </p>
      {escolha ? (
        <Confirmacao
          texto={
            <>
              Ligar {c.quantos === 1 ? 'este filiado' : `estes ${c.quantos} filiados`} a{' '}
              <strong>
                {escolha.nome}/{escolha.uf}
              </strong>
              ?
            </>
          }
          salvando={salvando}
          onConfirmar={confirmar}
          onCancelar={() => setEscolha(null)}
        />
      ) : procurando ? (
        <div className="space-y-1">
          <SeletorDeEnte
            valor={null}
            soMunicipios
            rotulo=""
            placeholder="Digite o município certo…"
            rodape="Só municípios: filiado mora em município, não em Estado."
            autoFocus
            onEscolher={(e: EnteResumido | null) => {
              if (!e) return;
              setEscolha({ codigo: e.codigo, nome: e.nome, uf: e.uf });
              setProcurando(false);
            }}
          />
          <button
            type="button"
            onClick={() => setProcurando(false)}
            className="inline-flex min-h-9 items-center px-1 text-xs text-muted-foreground hover:underline"
          >
            cancelar
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {(c.sugestoes ?? []).map((s, k) => (
            <button
              key={s.codigo}
              type="button"
              onClick={() => setEscolha(s)}
              title={MOTIVO[s.motivo]}
              className={cn(
                'inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition hover:bg-muted',
                k === 0 &&
                  'border-brand-300 bg-brand-50 text-brand-900 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100',
              )}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {s.nome}/{s.uf}
              {s.motivo === 'MESMO_NOME_EM_OUTRA_UF' && (
                <span className="font-normal text-muted-foreground">· outro estado</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setProcurando(true)}
            className="inline-flex min-h-9 items-center rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground transition hover:bg-muted"
          >
            outro município…
          </button>
        </div>
      )}
    </li>
  );
}

function LinhaDeOrgao({
  o,
  onFeito,
}: {
  o: { id: string; nome: string; filiados: number };
  onFeito: () => void;
}) {
  const [ente, setEnte] = useState<EnteResumido | null>(null);
  const [salvando, setSalvando] = useState(false);
  const quem = (e: EnteResumido) =>
    e.esfera === 'M' ? `Prefeitura de ${e.nome}` : e.esfera === 'E' ? `Governo do Estado — ${e.nome}` : e.nome;

  async function confirmar() {
    if (!ente) return;
    setSalvando(true);
    try {
      await ligarOrganizacao(o.id, ente.codigo);
      toast.success(`${o.nome} agora responde ao ${quem(ente)}.`);
      setEnte(null);
      onFeito();
    } catch (e) {
      /* 409 = alguém definiu o governo dele em Organizações enquanto isto estava aberto. */
      toast.error((e as Error).message || 'Não foi possível salvar.');
      onFeito();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <li className="space-y-2 px-3 py-2.5">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <Building2 className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden />
        <span className="font-medium">{o.nome}</span>
        <span className="text-xs text-muted-foreground">
          {o.filiados} {o.filiados === 1 ? 'filiado trabalha lá' : 'filiados trabalham lá'}
        </span>
      </p>
      {ente ? (
        <Confirmacao
          texto={
            <>
              <strong>{o.nome}</strong> é do <strong>{quem(ente)}</strong>?
            </>
          }
          salvando={salvando}
          onConfirmar={confirmar}
          onCancelar={() => setEnte(null)}
        />
      ) : (
        <SeletorDeEnte
          valor={null}
          rotulo=""
          placeholder="De qual governo? Ex.: piauí, teresina…"
          rodape="Quem paga a folha dele — não onde ele fica."
          onEscolher={(e) => setEnte(e)}
        />
      )}
    </li>
  );
}

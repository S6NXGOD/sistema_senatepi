'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Eye,
  FileText,
  IdCard,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { abrirPdf } from '@/lib/pdf';
import { desfiliarFiliado, excluirFiliado, Filiado } from '@/lib/filiados';

/**
 * Menu de ações (dropdown) de cada linha da tabela de filiados. Concentra as
 * ações de navegação/PDF e as ações de gestão "Desfiliar" e "Excluir", cada uma
 * com seu modal de confirmação. `onChanged` deve revalidar a listagem.
 */
export function FiliadoRowActions({
  filiado,
  onChanged,
}: {
  filiado: Filiado;
  onChanged: () => void;
}) {
  const router = useRouter();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const [modal, setModal] = useState<null | 'desfiliar' | 'excluir'>(null);
  const [loading, setLoading] = useState(false);

  const jaDesfiliado = filiado.situacao === 'DESFILIADO';

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    // Posição fixa a partir do botão: evita corte pelo container com overflow.
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  }

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  async function handleDesfiliar() {
    setLoading(true);
    try {
      await desfiliarFiliado(filiado.id);
      toast.success(`${filiado.nomeCompleto} foi desfiliado(a).`);
      setModal(null);
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível desfiliar.');
    } finally {
      setLoading(false);
    }
  }

  async function handleExcluir() {
    setLoading(true);
    try {
      await excluirFiliado(filiado.id);
      toast.success(`${filiado.nomeCompleto} foi excluído(a) permanentemente.`);
      setModal(null);
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button ref={btnRef} variant="ghost" size="icon" title="Ações" onClick={toggle}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {open && coords && (
        <>
          {/* Camada para fechar ao clicar fora */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-md border bg-card py-1 text-sm shadow-lg"
            style={{ top: coords.top, right: coords.right }}
          >
            <MenuItem icon={<Eye className="h-4 w-4" />} onClick={() => run(() => router.push(`/filiados/${filiado.id}`))}>
              Visualizar
            </MenuItem>
            <MenuItem icon={<Pencil className="h-4 w-4" />} onClick={() => run(() => router.push(`/filiados/${filiado.id}/editar`))}>
              Editar
            </MenuItem>
            <MenuItem icon={<RefreshCw className="h-4 w-4" />} onClick={() => run(() => router.push(`/filiados/${filiado.id}/recadastrar`))}>
              Recadastrar
            </MenuItem>
            <MenuItem icon={<IdCard className="h-4 w-4" />} onClick={() => run(() => abrirPdf(`/filiados/${filiado.id}/carteirinha/pdf`))}>
              Carteirinha (QR)
            </MenuItem>
            <MenuItem icon={<FileText className="h-4 w-4" />} onClick={() => run(() => abrirPdf(`/filiados/${filiado.id}/termo/pdf`))}>
              Termo de consentimento
            </MenuItem>

            <div className="my-1 border-t" />

            <MenuItem
              icon={<UserX className="h-4 w-4" />}
              disabled={jaDesfiliado}
              className="text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
              onClick={() => run(() => setModal('desfiliar'))}
            >
              {jaDesfiliado ? 'Já desfiliado' : 'Desfiliar'}
            </MenuItem>
            <MenuItem
              icon={<Trash2 className="h-4 w-4" />}
              className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              onClick={() => run(() => setModal('excluir'))}
            >
              Excluir
            </MenuItem>
          </div>
        </>
      )}

      {/* Desfiliação — aviso (perde acesso a eventos) */}
      <ConfirmDialog
        open={modal === 'desfiliar'}
        variant="default"
        title="Desfiliar associado?"
        confirmLabel="Desfiliar"
        loading={loading}
        icon={<UserX className="h-6 w-6" />}
        onConfirm={handleDesfiliar}
        onClose={() => (loading ? null : setModal(null))}
        description={
          <>
            <strong>{filiado.nomeCompleto}</strong> será marcado como{' '}
            <strong>DESFILIADO</strong> e perderá o acesso a eventos e à Colônia de
            Férias. O cadastro é preservado e a situação pode ser revertida depois.
          </>
        }
      />

      {/* Exclusão — destrutivo/permanente (LGPD) */}
      <ConfirmDialog
        open={modal === 'excluir'}
        variant="destructive"
        title="Excluir filiado permanentemente?"
        confirmLabel="Excluir definitivamente"
        loading={loading}
        icon={<Trash2 className="h-6 w-6" />}
        onConfirm={handleExcluir}
        onClose={() => (loading ? null : setModal(null))}
        description={
          <>
            Esta ação remove <strong>{filiado.nomeCompleto}</strong> e todos os seus
            dados de forma <strong>permanente e irreversível</strong>, em atenção ao
            direito de eliminação previsto na Lei Geral de Proteção de Dados Pessoais
            (LGPD — Lei nº 13.709/2018). Esta operação não pode ser desfeita.
          </>
        }
      />
    </>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  className,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

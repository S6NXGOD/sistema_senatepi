'use client';

import { ReactNode } from 'react';
import { Share, MoreVertical, Smartphone } from 'lucide-react';
import { useDeviceDetect, SistemaOperacional } from '@/hooks/use-device-detect';

const CONTEUDO: Record<SistemaOperacional, { Icon: typeof Share; texto: ReactNode }> = {
  ios: {
    Icon: Share,
    texto: (
      <>
        Instale o app Administrativo! Toque em <strong>Compartilhar</strong> e{' '}
        <strong>“Adicionar à Tela de Início”</strong>.
      </>
    ),
  },
  android: {
    Icon: MoreVertical,
    texto: (
      <>
        Instale o app Administrativo! Toque nos <strong>3 pontos</strong> e{' '}
        <strong>“Instalar Aplicativo”</strong>.
      </>
    ),
  },
  desktop: {
    Icon: Smartphone,
    texto: (
      <>
        O App Admin também está disponível para o seu celular. Acesse este link pelo{' '}
        <strong>Safari</strong> ou <strong>Chrome</strong> para instalar.
      </>
    ),
  },
};

/** Aviso de instalação do PWA (exclusivo do administrativo). Some se já instalado. */
export function InstallHint() {
  const { os, isStandalone, pronto } = useDeviceDetect();
  if (!pronto || isStandalone) return null;

  const { Icon, texto } = CONTEUDO[os];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-senatepi-600/40 bg-senatepi-50 p-3 text-sm text-senatepi-900 dark:border-senatepi-400/30 dark:bg-senatepi-900/20 dark:text-senatepi-200">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-senatepi-700 dark:text-senatepi-400" />
      <p className="leading-snug">{texto}</p>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';

export type SistemaOperacional = 'ios' | 'android' | 'desktop';

export interface DeviceInfo {
  os: SistemaOperacional;
  isIOS: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  /** true quando o app já está rodando instalado (modo standalone/PWA). */
  isStandalone: boolean;
  /** false no SSR/primeira renderização; true após hidratar no cliente. */
  pronto: boolean;
}

const INICIAL: DeviceInfo = {
  os: 'desktop',
  isIOS: false,
  isAndroid: false,
  isDesktop: true,
  isStandalone: false,
  pronto: false,
};

/** Detecta o sistema (iOS/Android/Desktop) e se o app já está instalado. */
export function useDeviceDetect(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(INICIAL);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent || '';
    const isAndroid = /android/i.test(ua);
    // iPadOS moderno se reporta como "Macintosh" com suporte a toque.
    const isIOS =
      /iphone|ipad|ipod/i.test(ua) ||
      (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
    const os: SistemaOperacional = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
    const isStandalone =
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(display-mode: standalone)').matches) ||
      // iOS Safari
      (typeof navigator !== 'undefined' && (navigator as unknown as { standalone?: boolean }).standalone === true);

    setInfo({ os, isIOS, isAndroid, isDesktop: os === 'desktop', isStandalone: !!isStandalone, pronto: true });
  }, []);

  return info;
}

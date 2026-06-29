'use client';

import { useEffect } from 'react';
import { useAppConfig } from './useAppConfig.js';

/**
 * Phase 3 (2026-06-28) — live branding tokens.
 *
 * Reads the appConfig and writes its colour palette + font family to the
 * document root as CSS custom properties, so any Tailwind / CSS rule that
 * references them re-renders when the developer flips a colour from
 * `dev.accesly.xyz`. No explicit subscription — `useAppConfig` already
 * refetches every 60s + on visibility:visible.
 *
 * The variable names are deliberately namespaced (`--accesly-*`) so the
 * integrator can keep their own palette and only opt-in to Accesly's tokens
 * for the parts of the UI that need to match the configured brand.
 *
 * Variables emitted (each one optional — only present if the appConfig sets
 * them):
 *   --accesly-primary
 *   --accesly-secondary
 *   --accesly-accent
 *   --accesly-ink
 *   --accesly-danger
 *   --accesly-success
 *   --accesly-font-family
 *
 * `--accesly-primary` also falls back to the legacy `branding.primaryColor`
 * field so apps created pre-schema-v1 still get something.
 */
export interface UseBrandingResult {
  readonly hasBranding: boolean;
  readonly displayName: string | null;
  readonly logoUrl: string | null;
}

export function useBranding(): UseBrandingResult {
  const { config } = useAppConfig();
  const branding = config?.branding;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const written: string[] = [];

    function set(name: string, value: string | undefined): void {
      if (!value) return;
      root.style.setProperty(name, value);
      written.push(name);
    }

    const primary = branding?.colors?.primary ?? branding?.primaryColor;
    set('--accesly-primary', primary);
    set('--accesly-secondary', branding?.colors?.secondary);
    set('--accesly-accent', branding?.colors?.accent);
    set('--accesly-ink', branding?.colors?.ink);
    set('--accesly-danger', branding?.colors?.danger);
    set('--accesly-success', branding?.colors?.success);
    set('--accesly-font-family', branding?.fontFamily);

    return () => {
      // Remove the vars we wrote so unmounting <AcceslyProvider> doesn't leave
      // stale colours behind. Other vars set by the host app stay untouched.
      for (const name of written) root.style.removeProperty(name);
    };
  }, [
    branding?.colors?.primary,
    branding?.colors?.secondary,
    branding?.colors?.accent,
    branding?.colors?.ink,
    branding?.colors?.danger,
    branding?.colors?.success,
    branding?.fontFamily,
    branding?.primaryColor,
  ]);

  return {
    hasBranding: !!branding,
    displayName: branding?.displayName ?? null,
    logoUrl: branding?.logoUrl ?? null,
  };
}

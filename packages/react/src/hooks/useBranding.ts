'use client';

import { useEffect, useMemo } from 'react';
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
 *
 * **Landing copy (2.3.0+):** `landingTitle`, `landingHighlight` y
 * `landingSubtitle` se devuelven **pre-interpoladas** — `{appName}` se
 * reemplaza por `displayName`. Si el dev no setea el campo, devolvemos
 * `null` y el integrador usa su fallback (no inventamos copy default).
 */
export interface UseBrandingResult {
  readonly hasBranding: boolean;
  readonly displayName: string | null;
  readonly logoUrl: string | null;
  /** Color primario crudo (hex). Útil para construir gradientes inline. `null` si no se setea. */
  readonly primaryColor: string | null;
  /** Color secundario. Se usa para el segundo stop del gradient de marca. */
  readonly secondaryColor: string | null;
  /** Headline grande de la Landing. `null` si el dev no la setea. */
  readonly landingTitle: string | null;
  /** Texto con gradient (subline del headline). `null` si no se setea. */
  readonly landingHighlight: string | null;
  /** Párrafo descriptivo debajo del headline. `null` si no se setea. */
  readonly landingSubtitle: string | null;
  /**
   * Texto del botón launcher cuando el user NO está autenticado. `null` →
   * integrador usa su default (ej. "Iniciar sesión"). Pre-interpolado.
   */
  readonly loginButtonText: string | null;
  /**
   * Resuelve variables `{appName}` etc. en cualquier template string.
   * Útil para integradores que quieran usar el sistema en copy custom
   * (ej. emails, otros banners). Si la variable no existe queda el
   * placeholder visible — better-than-blank, ayuda a detectar typos.
   */
  text(template: string | null | undefined): string | null;
}

/** Mint default — segundo stop del gradient cuando el dev no setea `secondary`. */
const DEFAULT_SECONDARY = '#45C9A8';

/**
 * Interpolation sintaxis: `{varName}`. Único var soportado por ahora:
 *   {appName} → branding.displayName
 *
 * Reglas:
 *  - `{appName}` con displayName='' o null → queda el literal `{appName}`
 *    visible. Esto fuerza al dev a setear displayName antes de usar la var.
 *  - Variables desconocidas (`{foo}`) quedan literales también.
 *  - Brace escape: `{{` y `}}` no se interpretan (idiomático tipo Python).
 */
function interpolate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{/g, '\x00OPEN\x00')
    .replace(/\}\}/g, '\x00CLOSE\x00')
    .replace(/\{(\w+)\}/g, (match, key: string) => {
      const v = vars[key];
      // Si la var existe pero está vacía, dejar el placeholder visible
      // — es más útil para el dev que un texto roto.
      return v && v.length > 0 ? v : match;
    })
    .replace(/\x00OPEN\x00/g, '{')
    .replace(/\x00CLOSE\x00/g, '}');
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
    const secondary = branding?.colors?.secondary ?? branding?.secondaryColor;
    set('--accesly-primary', primary);
    set('--accesly-secondary', secondary);
    set('--accesly-accent', branding?.colors?.accent);
    set('--accesly-ink', branding?.colors?.ink);
    set('--accesly-danger', branding?.colors?.danger);
    set('--accesly-success', branding?.colors?.success);
    set('--accesly-font-family', branding?.fontFamily);
    // Gradient compuesto: si el dev seteó primary, lo usamos como primer stop.
    // Segundo stop = secondary del dev (si existe) o nuestro mint default.
    // Esto deja `var(--accesly-grad)` listo para usar en cualquier `background:`
    // sin que el integrador tenga que componer el linear-gradient a mano.
    if (primary) {
      set('--accesly-grad', `linear-gradient(135deg, ${primary}, ${secondary ?? DEFAULT_SECONDARY})`);
    }

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

  // Vars table — solo `{appName}` por ahora. Lo memoizamos para que el
  // helper `text()` se mantenga estable entre renders (útil si el caller
  // pasa el helper a un useEffect/useMemo deps array).
  const vars = useMemo<Record<string, string>>(
    () => ({ appName: branding?.displayName ?? '' }),
    [branding?.displayName],
  );

  const landingTitle = useMemo(
    () => (branding?.landingTitle ? interpolate(branding.landingTitle, vars) : null),
    [branding?.landingTitle, vars],
  );
  const landingHighlight = useMemo(
    () =>
      branding?.landingHighlight ? interpolate(branding.landingHighlight, vars) : null,
    [branding?.landingHighlight, vars],
  );
  const landingSubtitle = useMemo(
    () =>
      branding?.landingSubtitle ? interpolate(branding.landingSubtitle, vars) : null,
    [branding?.landingSubtitle, vars],
  );
  const loginButtonText = useMemo(
    () => (branding?.loginButtonText ? interpolate(branding.loginButtonText, vars) : null),
    [branding?.loginButtonText, vars],
  );

  const text = useMemo(
    () =>
      (template: string | null | undefined): string | null =>
        template ? interpolate(template, vars) : null,
    [vars],
  );

  return {
    hasBranding: !!branding,
    displayName: branding?.displayName ?? null,
    logoUrl: branding?.logoUrl ?? null,
    primaryColor: branding?.colors?.primary ?? branding?.primaryColor ?? null,
    secondaryColor: branding?.colors?.secondary ?? branding?.secondaryColor ?? null,
    landingTitle,
    landingHighlight,
    landingSubtitle,
    loginButtonText,
    text,
  };
}

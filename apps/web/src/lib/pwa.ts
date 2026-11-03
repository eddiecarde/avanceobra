"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(display-mode: standalone)";

/** ¿Se abrió desde el ícono instalado en el teléfono (y no en una pestaña del navegador)? */
export function isInstalledApp() {
  return window.matchMedia(QUERY).matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function subscribe(cb: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener?.("change", cb);
  return () => m.removeEventListener?.("change", cb);
}

/** En el servidor no se sabe: se toma como web y se corrige al cargar en el teléfono. */
export function useInstalledApp() {
  return useSyncExternalStore(subscribe, isInstalledApp, () => false);
}

"use client";

import { useSyncExternalStore } from "react";

const DESKTOP_QUERY = "(min-width: 1024px)";

export function subscribeDesktopLayout(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(DESKTOP_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

export function desktopLayoutMatches() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

export function useDesktopLayout() {
  return useSyncExternalStore(subscribeDesktopLayout, desktopLayoutMatches, () => false);
}

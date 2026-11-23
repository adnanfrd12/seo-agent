"use client";

import { useSyncExternalStore } from "react";

/* A value kept in localStorage (this browser only), read without effects so every component using the key stays in step. */
const EVT = "ga4x-stored";
const subscribe = (f: () => void) => { window.addEventListener(EVT, f); window.addEventListener("storage", f); return () => { window.removeEventListener(EVT, f); window.removeEventListener("storage", f); }; };
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

export function useStored(key: string | null): [string | null, (v: string) => void] {
  const v = useSyncExternalStore(subscribe, () => (key ? read(key) : null), () => null);
  const set = (val: string) => { if (!key) return; try { localStorage.setItem(key, val); } catch { /* storage blocked */ } window.dispatchEvent(new Event(EVT)); };
  return [v, set];
}

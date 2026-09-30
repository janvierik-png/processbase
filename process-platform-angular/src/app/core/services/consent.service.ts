import { Injectable, signal } from '@angular/core';

/**
 * #21 — rozhodnutia návštevníka o úložisku a externých službách. Aplikácia
 * nepoužíva reklamné ani analytické cookies; jediná voliteľná vec je načítanie
 * externého editora flowchartov (diagrams.net), ktoré sa bez súhlasu nespustí.
 * Rozhodnutie platí 12 mesiacov, potom sa znova opýtame.
 */
export interface ConsentState {
  /** externé služby vložené do stránky (diagrams.net) */
  externalEmbeds: boolean;
  /** oznámenie o úložisku bolo zobrazené a potvrdené */
  noticeSeen: boolean;
  decidedAt: string | null;
}

const KEY = 'pbConsent';
const VALID_MS = 365 * 24 * 60 * 60 * 1000;
const EMPTY: ConsentState = { externalEmbeds: false, noticeSeen: false, decidedAt: null };

@Injectable({ providedIn: 'root' })
export class ConsentService {
  readonly state = signal<ConsentState>(this.read());

  private read(): ConsentState {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as ConsentState | null;
      if (!raw?.decidedAt || Date.now() - new Date(raw.decidedAt).getTime() > VALID_MS) return { ...EMPTY };
      return { externalEmbeds: raw.externalEmbeds === true, noticeSeen: raw.noticeSeen === true, decidedAt: raw.decidedAt };
    } catch {
      return { ...EMPTY };
    }
  }

  private write(patch: Partial<ConsentState>): void {
    const next = { ...this.state(), ...patch, decidedAt: new Date().toISOString() };
    this.state.set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // súkromné okno bez úložiska — rozhodnutie platí do zatvorenia stránky
    }
  }

  dismissNotice(): void {
    this.write({ noticeSeen: true });
  }

  setExternalEmbeds(allowed: boolean): void {
    this.write({ externalEmbeds: allowed, noticeSeen: true });
  }

  /** Zabudnúť všetky rozhodnutia (stránka Cookies). */
  reset(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nič
    }
    this.state.set({ ...EMPTY });
  }
}

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConsentService } from '../core/services/consent.service';

/**
 * #21 — jednorazové oznámenie o úložisku v prehliadači. Nič nesleduje
 * a nič neblokuje (používa sa len nevyhnutné úložisko); externé služby
 * sa pýtajú na súhlas samy, až keď ich človek chce použiť.
 */
@Component({
  selector: 'pp-storage-notice',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (!consent.state().noticeSeen) {
      <aside class="storage-notice" role="region" aria-label="Oznámenie o cookies">
        <p>Nepoužívame reklamné ani analytické cookies. V prehliadači ukladáme len to, čo aplikácia potrebuje na fungovanie
          (prihlásenie, predvoľby, rozpracovaný diagram). <a routerLink="/cookies">Podrobnosti a nastavenia</a></p>
        <button type="button" (click)="consent.dismissNotice()">Rozumiem</button>
      </aside>
    }
  `,
  styles: [`
    .storage-notice {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: min(560px, calc(100vw - 32px));
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: var(--r-lg, 12px);
      background: var(--panel, #fff);
      box-shadow: 0 8px 24px rgba(22, 32, 46, 0.12);
      font-size: 13px;
      color: var(--ink);
    }
    p { margin: 0; line-height: 1.45; }
    a { color: var(--accent-strong); }
    button { flex: none; }
    @media (max-width: 520px) { .storage-notice { flex-direction: column; align-items: stretch; } }
  `]
})
export class StorageNoticeComponent {
  constructor(readonly consent: ConsentService) {}
}

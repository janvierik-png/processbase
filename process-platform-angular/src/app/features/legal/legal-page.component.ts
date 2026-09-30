import { Component, OnInit, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConsentService } from '../../core/services/consent.service';
import { BROWSER_STORAGE, LEGAL_DRAFT, OPERATOR, SUBPROCESSORS, TERMS_VERSION } from './legal-info';

type LegalDoc = 'terms' | 'privacy' | 'cookies';

const TITLES: Record<LegalDoc, string> = {
  terms: 'Podmienky používania',
  privacy: 'Zásady ochrany osobných údajov',
  cookies: 'Cookies a úložisko v prehliadači'
};

/**
 * #21 — právne texty (návrh na kontrolu právnikom). Obsah zodpovedá tomu,
 * čo aplikácia naozaj robí: žiadne sledovacie cookies, len nevyhnutné
 * úložisko v prehliadači, AI a preklad len na voľbu firmy, diagrams.net
 * len po súhlase pri otvorení editora flowchartu.
 */
@Component({
  selector: 'pp-legal-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './legal-page.component.html',
  styleUrl: './legal-page.component.scss'
})
export class LegalPageComponent implements OnInit {
  readonly doc = signal<LegalDoc>('terms');
  readonly operator = OPERATOR;
  readonly subprocessors = SUBPROCESSORS;
  readonly storage = BROWSER_STORAGE;
  readonly version = TERMS_VERSION;
  readonly draft = LEGAL_DRAFT;
  readonly titles = TITLES;
  readonly saved = signal('');

  constructor(
    private readonly route: ActivatedRoute,
    private readonly title: Title,
    readonly consent: ConsentService
  ) {}

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      const doc = (data['doc'] as LegalDoc) ?? 'terms';
      this.doc.set(doc);
      this.title.setTitle(`${TITLES[doc]} | Process Base`);
      this.saved.set('');
    });
  }

  setEmbeds(allowed: boolean): void {
    this.consent.setExternalEmbeds(allowed);
    this.saved.set(allowed ? 'Externý editor flowchartov sa načíta bez ďalšej otázky.' : 'Externý editor flowchartov sa bez vášho súhlasu nenačíta.');
  }

  resetConsent(): void {
    this.consent.reset();
    this.saved.set('Rozhodnutia sú zabudnuté — pri ďalšej návšteve sa znova opýtame.');
  }
}

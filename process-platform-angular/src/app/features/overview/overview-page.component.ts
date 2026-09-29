import { Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Overview, OverviewKey } from '../../core/models/process.model';
import { ProcessStoreService } from '../../core/services/process-store.service';

type CardMeta = { title: string; hint: string; fix: string; warn: boolean; target: 'process' | 'organization' };

/**
 * Prehľad (#34 UX-01b): čo treba vo firme napraviť. Každá karta je zoznam
 * procesov s konkrétnym problémom a odkazom na miesto nápravy — číslo na
 * karte je počet riadkov v zozname, nie skóre ani odhad zhody s normou.
 */
@Component({
  selector: 'pp-overview-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './overview-page.component.html',
  styleUrl: './overview-page.component.scss'
})
export class OverviewPageComponent implements OnInit {
  readonly overview = signal<Overview | null>(null);
  readonly error = signal('');
  readonly selected = signal<OverviewKey | null>(null);

  readonly meta: Record<OverviewKey, CardMeta> = {
    review: { title: 'Na revíziu', hint: 'Platná verzia má termín revízie po termíne alebo do 30 dní.', fix: 'Skontrolovať proces', warn: true, target: 'process' },
    pendingApproval: { title: 'Čaká na schválenie', hint: 'Návrh je odoslaný schvaľovateľovi a čaká na rozhodnutie.', fix: 'Posúdiť návrh', warn: false, target: 'process' },
    staleDocuments: { title: 'Dokument po účinnosti', hint: 'Platná verzia procesu odkazuje na dokument, ktorý nahradila novšia verzia.', fix: 'Prevziať novú verziu', warn: true, target: 'process' },
    feedback: { title: 'Nevybavené podnety', hint: 'Kolegovia nahlásili chybu alebo navrhli zlepšenie.', fix: 'Posúdiť podnety', warn: false, target: 'process' },
    ownerless: { title: 'Bez vlastníka', hint: 'Za proces nezodpovedá žiadne pracovné miesto.', fix: 'Určiť vlastníka', warn: true, target: 'process' },
    vacant: { title: 'Neobsadené miesta', hint: 'Proces závisí od miesta, ktoré dnes nikto nezastáva.', fix: 'Obsadiť v Organizácii', warn: true, target: 'organization' },
    incomplete: { title: 'Neúplné', hint: 'Chýbajú povinné údaje na publikovanie.', fix: 'Doplniť údaje', warn: false, target: 'process' },
    unpublished: { title: 'Bez platnej verzie', hint: 'Kolegovia proces nevidia ako platný postup.', fix: 'Otvoriť návrh', warn: false, target: 'process' },
    pendingChanges: { title: 'Nepublikované zmeny', hint: 'Návrh sa líši od platnej verzie — zmeny ešte neplatia.', fix: 'Publikovať zmeny', warn: false, target: 'process' }
  };

  readonly current = computed(() => this.overview()?.categories.find((category) => category.key === this.selected()) ?? null);
  readonly allClear = computed(() => (this.overview()?.categories ?? []).every((category) => category.count === 0));

  constructor(
    private readonly store: ProcessStoreService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.store.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        // odkaz s ?kategoria= otvorí konkrétny zoznam, inak prvý s problémom
        const wanted = this.route.snapshot.queryParamMap.get('kategoria') as OverviewKey | null;
        const first = overview.categories.find((category) => category.count > 0)?.key ?? null;
        this.selected.set(wanted && this.meta[wanted] ? wanted : first);
      },
      error: () => this.error.set('Prehľad sa nepodarilo načítať.')
    });
  }

  select(key: OverviewKey): void {
    this.selected.set(key);
    this.router.navigate([], { relativeTo: this.route, queryParams: { kategoria: key }, replaceUrl: true });
  }

  processesLabel(count: number): string {
    return `${count} ${count === 1 ? 'proces' : count >= 2 && count <= 4 ? 'procesy' : 'procesov'}`;
  }

  fixLink(key: OverviewKey, processId: string): string[] {
    return this.meta[key].target === 'organization' ? ['/app/settings/positions'] : ['/app/processes', processId];
  }
}

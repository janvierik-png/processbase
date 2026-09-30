import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SearchMatch, SearchResult } from '../../core/models/process.model';
import { ProcessStoreService } from '../../core/services/process-store.service';

type KindFilter = 'all' | SearchMatch['kind'];

/**
 * Vyhľadávanie (#35 UX-01c): procesy (platné, návrhy, archív), pracovné miesta
 * a dokumenty — len vlastnej firmy, rovnako ako ostatné časti aplikácie.
 */
@Component({
  selector: 'pp-search-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './search-page.component.html',
  styleUrl: './search-page.component.scss'
})
export class SearchPageComponent implements OnInit {
  readonly result = signal<SearchResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly filter = signal<KindFilter>('all');
  query = '';

  readonly filters: Array<{ key: KindFilter; label: string }> = [
    { key: 'all', label: 'Všetko' },
    { key: 'published', label: 'Platné' },
    { key: 'draft', label: 'Návrhy' },
    { key: 'archive', label: 'Archív' }
  ];

  /** procesy len so zhodami zvoleného druhu */
  readonly processes = computed(() => {
    const filter = this.filter();
    return (this.result()?.processes ?? [])
      .map((item) => ({ ...item, matches: filter === 'all' ? item.matches : item.matches.filter((match) => match.kind === filter) }))
      .filter((item) => item.matches.length > 0);
  });

  constructor(
    private readonly store: ProcessStoreService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.query = params.get('q') ?? '';
      this.run();
    });
  }

  submit(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { q: this.query.trim() || null } });
  }

  private run(): void {
    const query = this.query.trim();
    this.error.set('');
    if (query.length < 2) {
      this.result.set(null);
      return;
    }
    this.loading.set(true);
    this.store.search(query).subscribe({
      next: (result) => {
        this.result.set(result);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Vyhľadávanie zlyhalo.');
        this.loading.set(false);
      }
    });
  }

  label(match: SearchMatch): string {
    if (match.kind === 'draft') return 'Návrh';
    if (match.kind === 'archive') return `Archív v${match.revision}`;
    return match.state === 'scheduled' ? `Naplánovaná v${match.revision}` : `Platná v${match.revision}`;
  }

  /** úryvok rozdelený na text pred zhodou, zhodu a zvyšok — zvýraznenie bez innerHTML */
  parts(match: SearchMatch): [string, string, string] {
    const { text, start, length } = match.snippet;
    return [text.slice(0, start), text.slice(start, start + length), text.slice(start + length)];
  }

  empty(): boolean {
    const result = this.result();
    return Boolean(result) && this.processes().length === 0 && result!.positions.length === 0 && result!.documents.length === 0 && (result!.systems ?? []).length === 0;
  }
}

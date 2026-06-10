import { Component, OnInit, signal } from '@angular/core';
import { PlatformStats } from '../../core/models/backoffice.model';
import { BackofficeApiService } from '../../core/services/backoffice-api.service';

@Component({
  selector: 'bo-dashboard-page',
  standalone: true,
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss'
})
export class DashboardPageComponent implements OnInit {
  readonly stats = signal<PlatformStats | null>(null);
  readonly error = signal<string | null>(null);

  constructor(private readonly api: BackofficeApiService) {}

  ngOnInit(): void {
    this.api.stats().subscribe({
      next: (stats) => this.stats.set(stats),
      error: () => this.error.set('Statistiky sa nepodarilo nacitat. Bezi API platformy na porte 3000?')
    });
  }
}

import { Component, OnInit, signal } from '@angular/core';
import { OrganizationOverview } from '../../core/models/backoffice.model';
import { BackofficeApiService } from '../../core/services/backoffice-api.service';

@Component({
  selector: 'bo-organizations-page',
  standalone: true,
  templateUrl: './organizations-page.component.html',
  styleUrl: './organizations-page.component.scss'
})
export class OrganizationsPageComponent implements OnInit {
  readonly organizations = signal<OrganizationOverview[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);

  constructor(private readonly api: BackofficeApiService) {}

  ngOnInit(): void {
    this.api.organizations().subscribe({
      next: (organizations) => {
        this.organizations.set(organizations);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Organizacie sa nepodarilo nacitat.');
        this.loading.set(false);
      }
    });
  }
}

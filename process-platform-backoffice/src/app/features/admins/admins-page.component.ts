import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackofficeAdmin } from '../../core/models/backoffice.model';
import { BackofficeApiService } from '../../core/services/backoffice-api.service';
import { BackofficeAuthService } from '../../core/services/backoffice-auth.service';

@Component({
  selector: 'bo-admins-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './admins-page.component.html',
  styleUrl: './admins-page.component.scss'
})
export class AdminsPageComponent implements OnInit {
  readonly admins = signal<BackofficeAdmin[]>([]);
  readonly error = signal<string | null>(null);

  model = { username: '', password: '' };
  passwordModel = { current: '', next: '', repeat: '' };
  readonly passwordNotice = signal<string | null>(null);

  constructor(
    private readonly api: BackofficeApiService,
    readonly auth: BackofficeAuthService
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.admins().subscribe({
      next: (admins) => this.admins.set(admins),
      error: () => this.error.set('Adminov sa nepodarilo nacitat.')
    });
  }

  create(): void {
    if (!this.model.username.trim() || !this.model.password) return;
    this.api.createAdmin(this.model.username.trim(), this.model.password).subscribe({
      next: () => {
        this.model = { username: '', password: '' };
        this.error.set(null);
        this.reload();
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Admina sa nepodarilo vytvorit.')
    });
  }

  changePassword(): void {
    this.passwordNotice.set(null);
    if (this.passwordModel.next !== this.passwordModel.repeat) {
      this.error.set('Nové heslá sa nezhodujú.');
      return;
    }
    this.api.changeOwnPassword(this.passwordModel.current, this.passwordModel.next).subscribe({
      next: () => {
        this.passwordModel = { current: '', next: '', repeat: '' };
        this.error.set(null);
        this.passwordNotice.set('Heslo zmenené.');
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Heslo sa nepodarilo zmeniť.')
    });
  }

  remove(admin: BackofficeAdmin): void {
    if (!window.confirm(`Vymazat admina ${admin.username}?`)) return;
    this.api.deleteAdmin(admin.id).subscribe({
      next: () => this.reload(),
      error: (error) => this.error.set(error?.error?.message ?? 'Admina sa nepodarilo vymazat.')
    });
  }
}

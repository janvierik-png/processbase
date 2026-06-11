import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';

const TOKEN_KEY = 'boToken';
const USERNAME_KEY = 'boUsername';

@Injectable({ providedIn: 'root' })
export class BackofficeAuthService {
  readonly username = signal<string | null>(localStorage.getItem(USERNAME_KEY));
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  constructor(
    private readonly http: HttpClient,
    private readonly router: Router
  ) {}

  token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return Boolean(this.token());
  }

  login(username: string, password: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.post<{ token: string; username: string }>('/api/backoffice/auth/login', { username, password }).subscribe({
      next: (response) => {
        localStorage.setItem(TOKEN_KEY, response.token);
        localStorage.setItem(USERNAME_KEY, response.username);
        this.username.set(response.username);
        this.loading.set(false);
        this.router.navigateByUrl('/dashboard');
      },
      error: (error) => {
        this.error.set(error?.error?.message ?? 'Prihlasenie zlyhalo.');
        this.loading.set(false);
      }
    });
  }

  logout(): void {
    this.http.post('/api/backoffice/auth/logout', {}).subscribe({ error: () => undefined });
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    this.username.set(null);
    this.router.navigateByUrl('/login');
  }

  // Volane interceptorom pri 401 — token expiroval alebo je neplatny.
  sessionExpired(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    this.username.set(null);
    this.router.navigateByUrl('/login');
  }
}

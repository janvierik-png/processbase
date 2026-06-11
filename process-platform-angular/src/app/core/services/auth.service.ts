import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { Organization } from '../models/organization.model';
import { Invitation, RoleId, TranslationSettings, User } from '../models/user.model';
import { StorageService } from './storage.service';
import { API_BASE_URL } from './api-url';

interface RegisterPayload {
  organizationName: string;
  ownerName: string;
  email: string;
  password: string;
}

interface AuthResponse {
  user: User;
  organization: Organization;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserKey = 'ngCurrentUser';
  private readonly currentOrgKey = 'ngCurrentOrganization';

  readonly currentUserSignal = signal<User | null>(this.storage.read<User | null>(this.currentUserKey, null));
  readonly currentOrganizationSignal = signal<Organization | null>(this.storage.read<Organization | null>(this.currentOrgKey, null));
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);

  constructor(
    private readonly storage: StorageService,
    private readonly http: HttpClient,
    private readonly router: Router
  ) {}

  isAuthenticated(): boolean {
    return Boolean(this.currentUserSignal());
  }

  currentUser(): User | null {
    return this.currentUserSignal();
  }

  currentOrganization(): Organization | null {
    return this.currentOrganizationSignal();
  }

  currentOrganizationId(): string | null {
    return this.currentOrganizationSignal()?.id ?? null;
  }

  registerOwner(payload: RegisterPayload): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.post<AuthResponse>(`${API_BASE_URL}/register`, payload).subscribe({
      next: (response) => {
        this.setSession(response);
        this.loading.set(false);
        this.router.navigateByUrl('/app/processes');
      },
      error: (error) => {
        this.error.set(error?.error?.message ?? 'Registracia zlyhala. Bezi API server?');
        this.loading.set(false);
      }
    });
  }

  login(email: string, password: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.post<AuthResponse>(`${API_BASE_URL}/login`, { email, password }).subscribe({
      next: (response) => {
        this.setSession(response);
        this.loading.set(false);
        this.router.navigateByUrl('/app/processes');
      },
      error: (error) => {
        this.error.set(error?.error?.message ?? 'Prihlasenie zlyhalo. Bezi API server?');
        this.loading.set(false);
      }
    });
  }

  logout(): void {
    this.currentUserSignal.set(null);
    this.currentOrganizationSignal.set(null);
    this.storage.remove(this.currentUserKey);
    this.storage.remove(this.currentOrgKey);
    this.router.navigateByUrl('/');
  }

  updateOrganizationName(name: string): void {
    const organizationId = this.currentOrganizationId();
    if (!organizationId) return;
    this.http.patch<Organization>(`${API_BASE_URL}/organizations/${organizationId}`, { name }).subscribe({
      next: (organization) => {
        this.currentOrganizationSignal.set(organization);
        this.storage.write(this.currentOrgKey, organization);
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Nazov organizacie sa nepodarilo ulozit.')
    });
  }

  organizationUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${API_BASE_URL}/organizations/${this.currentOrganizationId()}/users`);
  }

  invitations(): Observable<Invitation[]> {
    return this.http.get<Invitation[]>(`${API_BASE_URL}/organizations/${this.currentOrganizationId()}/invitations`);
  }

  createInvitation(email: string, roleId: RoleId): Observable<Invitation> {
    return this.http.post<Invitation>(`${API_BASE_URL}/organizations/${this.currentOrganizationId()}/invitations`, { email, roleId });
  }

  invitationByToken(token: string): Observable<Invitation & { organizationName: string; expired: boolean }> {
    return this.http.get<Invitation & { organizationName: string; expired: boolean }>(`${API_BASE_URL}/invitations/${token}`);
  }

  acceptInvitation(token: string, name: string, password: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.post<AuthResponse>(`${API_BASE_URL}/invitations/${token}/accept`, { name, password }).subscribe({
      next: (response) => {
        this.setSession(response);
        this.loading.set(false);
        this.router.navigateByUrl('/app/processes');
      },
      error: (error) => {
        this.error.set(error?.error?.message ?? 'Pozvanku sa nepodarilo prijat.');
        this.loading.set(false);
      }
    });
  }

  // R11: realtime kontrola dostupnosti
  checkEmail(value: string): Observable<{ available: boolean }> {
    return this.http.get<{ available: boolean }>(`${API_BASE_URL}/check/email?value=${encodeURIComponent(value)}`);
  }

  checkOrgName(value: string): Observable<{ available: boolean }> {
    return this.http.get<{ available: boolean }>(`${API_BASE_URL}/check/org-name?value=${encodeURIComponent(value)}`);
  }

  // R8: nastavenia automatickeho prekladu
  translationSettings(): Observable<TranslationSettings> {
    return this.http.get<TranslationSettings>(`${API_BASE_URL}/organizations/${this.currentOrganizationId()}/settings/translation`);
  }

  saveTranslationSettings(payload: { autoTranslate: boolean; provider: string; targetLocale: string; apiKey?: string }): Observable<TranslationSettings> {
    return this.http.post<TranslationSettings>(`${API_BASE_URL}/organizations/${this.currentOrganizationId()}/settings/translation`, payload);
  }

  private setSession(response: AuthResponse): void {
    this.currentUserSignal.set(response.user);
    this.currentOrganizationSignal.set(response.organization);
    this.storage.write(this.currentUserKey, response.user);
    this.storage.write(this.currentOrgKey, response.organization);
  }
}

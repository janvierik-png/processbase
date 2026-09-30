import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { Organization } from '../models/organization.model';
import { Invitation, RoleId, TranslationSettings, User } from '../models/user.model';
import { StorageService } from './storage.service';
import { API_BASE_URL } from './api-url';
import { DEFAULT_ROLES } from '../data/default-data';

interface RegisterPayload {
  organizationName: string;
  ownerName: string;
  email: string;
  password: string;
}

interface AuthResponse {
  token?: string;
  user: User;
  organization: Organization;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserKey = 'ngCurrentUser';
  private readonly currentOrgKey = 'ngCurrentOrganization';
  private readonly tokenKey = 'ngSessionToken';
  /** Kluce s obsahom firmy (strom procesov, aktivny proces) — mazu sa pri zmene relacie. */
  private readonly orgDataKeys = ['ngProcessTree', 'ngActiveProcessId'];

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

  /**
   * B7 — smie prihlásený používateľ danú akciu? Rovnaká matica ako na serveri
   * (DEFAULT_ROLES); vlastník smie všetko. Server to kontroluje aj tak — toto
   * len skrýva tlačidlá, ktoré by skončili chybou 403.
   */
  can(permission: 'organization:write' | 'user:invite' | 'process:write' | 'iso:write' | 'approval:approve'): boolean {
    const roleId = this.currentUserSignal()?.roleId;
    if (roleId === 'owner') return true;
    return DEFAULT_ROLES.find((role) => role.id === roleId)?.permissions.includes(permission) ?? false;
  }

  registerOwner(payload: RegisterPayload, redirectTo = '/app/processes'): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.post<AuthResponse>(`${API_BASE_URL}/register`, payload).subscribe({
      next: (response) => {
        this.setSession(response);
        this.loading.set(false);
        this.router.navigateByUrl(redirectTo);
      },
      error: (error) => {
        this.error.set(error?.error?.message ?? 'Registracia zlyhala. Bezi API server?');
        this.loading.set(false);
      }
    });
  }

  login(email: string, password: string, redirectTo = '/app/processes'): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.post<AuthResponse>(`${API_BASE_URL}/login`, { email, password }).subscribe({
      next: (response) => {
        this.setSession(response);
        this.loading.set(false);
        this.router.navigateByUrl(redirectTo);
      },
      error: (error) => {
        this.error.set(error?.error?.message ?? 'Prihlasenie zlyhalo. Bezi API server?');
        this.loading.set(false);
      }
    });
  }

  logout(): void {
    // #5 — relaciu treba zneplatnit aj na serveri, nielen zabudnut token
    const finish = () => {
      this.clearSession();
      this.router.navigateByUrl('/');
    };
    if (this.token()) {
      this.http.post(`${API_BASE_URL}/logout`, {}).subscribe({ next: finish, error: finish });
    } else {
      finish();
    }
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

  /** #37 — zapnutie povinného schvaľovania verzií procesov. */
  updateRequireApproval(requireApproval: boolean): void {
    const organizationId = this.currentOrganizationId();
    if (!organizationId) return;
    this.http.patch<Organization>(`${API_BASE_URL}/organizations/${organizationId}`, { requireApproval }).subscribe({
      next: (organization) => {
        this.currentOrganizationSignal.set(organization);
        this.storage.write(this.currentOrgKey, organization);
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Nastavenie sa nepodarilo uložiť.')
    });
  }

  /** #40 — profil „Kvalita a audit“: kontrolné otázky a pripravenosť evidencie. */
  updateQualityProfile(qualityProfile: boolean): void {
    const organizationId = this.currentOrganizationId();
    if (!organizationId) return;
    this.http.patch<Organization>(`${API_BASE_URL}/organizations/${organizationId}`, { qualityProfile }).subscribe({
      next: (organization) => {
        this.currentOrganizationSignal.set(organization);
        this.storage.write(this.currentOrgKey, organization);
      },
      error: (error) => this.error.set(error?.error?.message ?? 'Nastavenie sa nepodarilo uložiť.')
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

  // --- #20 overenie e-mailu a obnova hesla ---

  verifyEmail(token: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API_BASE_URL}/auth/verify-email`, { token });
  }

  resendVerification(): Observable<{ ok: boolean; alreadyVerified?: boolean }> {
    return this.http.post<{ ok: boolean; alreadyVerified?: boolean }>(`${API_BASE_URL}/auth/resend-verification`, {});
  }

  forgotPassword(email: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API_BASE_URL}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API_BASE_URL}/auth/reset-password`, { token, password });
  }

  /** Po overení e-mailu v tomto prehliadači — skryje upozornenie. */
  markEmailVerified(): void {
    const user = this.currentUserSignal();
    if (!user) return;
    const updated = { ...user, emailVerified: true };
    this.currentUserSignal.set(updated);
    this.storage.write(this.currentUserKey, updated);
  }

  private setSession(response: AuthResponse): void {
    // iny ucet alebo firma — neukazat ani na chvilu procesy predchadzajucej
    if (this.currentOrganizationId() !== response.organization.id) {
      for (const key of this.orgDataKeys) this.storage.remove(key);
    }
    this.currentUserSignal.set(response.user);
    this.currentOrganizationSignal.set(response.organization);
    this.storage.write(this.currentUserKey, response.user);
    this.storage.write(this.currentOrgKey, response.organization);
    if (response.token) this.storage.writeString(this.tokenKey, response.token);
  }

  /** Token relácie pre Authorization hlavičku (#1). */
  token(): string | null {
    return this.storage.readString(this.tokenKey, '') || null;
  }

  /** Vyčistí lokálny stav — volá sa aj pri 401 z interceptora. */
  clearSession(): void {
    this.currentUserSignal.set(null);
    this.currentOrganizationSignal.set(null);
    this.storage.remove(this.currentUserKey);
    this.storage.remove(this.currentOrgKey);
    this.storage.remove(this.tokenKey);
    // obsah firmy nesmie zostat v prehliadaci po odhlaseni (zdielany pocitac)
    for (const key of this.orgDataKeys) this.storage.remove(key);
  }
}

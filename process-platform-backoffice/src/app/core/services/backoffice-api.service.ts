import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BackofficeAdmin, IsoClause, IsoNorm, OrganizationOverview, PlatformStats, TranslationEntry } from '../models/backoffice.model';

// Relativna cesta — dev server proxuje /api na backend platformy (proxy.conf.json).
const API_BASE_URL = '/api/backoffice';

@Injectable({ providedIn: 'root' })
export class BackofficeApiService {
  constructor(private readonly http: HttpClient) {}

  stats(): Observable<PlatformStats> {
    return this.http.get<PlatformStats>(`${API_BASE_URL}/stats`);
  }

  organizations(): Observable<OrganizationOverview[]> {
    return this.http.get<OrganizationOverview[]>(`${API_BASE_URL}/organizations`);
  }

  translations(locale?: string): Observable<TranslationEntry[]> {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
    return this.http.get<TranslationEntry[]>(`${API_BASE_URL}/translations${query}`);
  }

  saveTranslation(locale: string, key: string, value: string): Observable<TranslationEntry> {
    return this.http.put<TranslationEntry>(`${API_BASE_URL}/translations`, { locale, key, value });
  }

  deleteTranslation(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/translations/${id}`);
  }

  importTranslations(items: Array<Pick<TranslationEntry, 'locale' | 'key' | 'value'>>): Observable<{ imported: number }> {
    return this.http.post<{ imported: number }>(`${API_BASE_URL}/translations/import`, { items });
  }

  // R4: ISO normy
  isoNorms(): Observable<IsoNorm[]> {
    return this.http.get<IsoNorm[]>(`${API_BASE_URL}/iso`);
  }

  createIsoNorm(payload: { name: string; version: string; language: string; pdfBase64?: string; structure?: IsoClause[] }): Observable<IsoNorm> {
    return this.http.post<IsoNorm>(`${API_BASE_URL}/iso`, payload);
  }

  updateIsoNorm(id: string, payload: Partial<{ name: string; version: string; language: string; structure: IsoClause[] }>): Observable<IsoNorm> {
    return this.http.patch<IsoNorm>(`${API_BASE_URL}/iso/${id}`, payload);
  }

  deleteIsoNorm(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/iso/${id}`);
  }

  // R9: sprava adminov
  admins(): Observable<BackofficeAdmin[]> {
    return this.http.get<BackofficeAdmin[]>(`${API_BASE_URL}/admins`);
  }

  createAdmin(username: string, password: string): Observable<BackofficeAdmin> {
    return this.http.post<BackofficeAdmin>(`${API_BASE_URL}/admins`, { username, password });
  }

  /** #19 — zmena vlastneho hesla (napr. docasneho z prveho spustenia). */
  changeOwnPassword(currentPassword: string, newPassword: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API_BASE_URL}/admins/me/password`, { currentPassword, newPassword });
  }

  deleteAdmin(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/admins/${id}`);
  }
}

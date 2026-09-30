import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ItSystem, SystemImpact } from '../models/user.model';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

export interface SystemPatch {
  name?: string;
  code?: string;
  description?: string;
  vendor?: string;
  url?: string;
  ownerPositionId?: string | null;
}

/** #43 — register IT systémov firmy a dopad ich zmeny. */
@Injectable({ providedIn: 'root' })
export class SystemService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  list(): Observable<ItSystem[]> {
    return this.http.get<ItSystem[]>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/systems`);
  }

  create(payload: SystemPatch & { name: string }): Observable<ItSystem> {
    return this.http.post<ItSystem>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/systems`, payload);
  }

  update(systemId: string, patch: SystemPatch): Observable<ItSystem> {
    return this.http.patch<ItSystem>(`${API_BASE_URL}/systems/${systemId}`, patch);
  }

  impact(systemId: string): Observable<SystemImpact> {
    return this.http.get<SystemImpact>(`${API_BASE_URL}/systems/${systemId}/impact`);
  }

  /** Vyradenie až po potvrdení dopadu (server bez potvrdenia odmietne). */
  archive(systemId: string): Observable<SystemImpact> {
    return this.http.post<SystemImpact>(`${API_BASE_URL}/systems/${systemId}/archive`, { confirm: true });
  }

  restore(systemId: string): Observable<ItSystem> {
    return this.http.post<ItSystem>(`${API_BASE_URL}/systems/${systemId}/restore`, {});
  }

  remove(systemId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/systems/${systemId}`);
  }
}

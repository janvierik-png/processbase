import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { OrgPosition, OrgUnit } from '../models/user.model';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class PositionService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  list(): Observable<OrgPosition[]> {
    return this.http.get<OrgPosition[]>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/positions`);
  }

  create(name: string, description: string, unitId?: string | null): Observable<OrgPosition> {
    return this.http.post<OrgPosition>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/positions`, { name, description, unitId: unitId || null });
  }

  update(positionId: string, patch: { name?: string; description?: string; unitId?: string | null }): Observable<OrgPosition> {
    return this.http.patch<OrgPosition>(`${API_BASE_URL}/positions/${positionId}`, patch);
  }

  // --- organizacne zlozky ---

  listUnits(): Observable<OrgUnit[]> {
    return this.http.get<OrgUnit[]>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/units`);
  }

  createUnit(name: string, description: string): Observable<OrgUnit> {
    return this.http.post<OrgUnit>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/units`, { name, description });
  }

  updateUnit(unitId: string, patch: { name?: string; description?: string }): Observable<OrgUnit> {
    return this.http.patch<OrgUnit>(`${API_BASE_URL}/units/${unitId}`, patch);
  }

  removeUnit(unitId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/units/${unitId}`);
  }

  remove(positionId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/positions/${positionId}`);
  }

  assign(userId: string, positionId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${API_BASE_URL}/users/${userId}/positions`, { positionId });
  }

  unassign(userId: string, positionId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/users/${userId}/positions/${positionId}`);
  }
}

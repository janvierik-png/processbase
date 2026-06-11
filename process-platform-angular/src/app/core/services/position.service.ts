import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { OrgPosition } from '../models/user.model';
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

  create(name: string, description: string): Observable<OrgPosition> {
    return this.http.post<OrgPosition>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/positions`, { name, description });
  }

  update(positionId: string, patch: { name?: string; description?: string }): Observable<OrgPosition> {
    return this.http.patch<OrgPosition>(`${API_BASE_URL}/positions/${positionId}`, patch);
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

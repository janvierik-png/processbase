import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { OrgPosition, OrgUnit } from '../models/user.model';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

export interface PositionPatch {
  name?: string;
  description?: string;
  unitId?: string | null;
  reportsToId?: string | null;
  jobProfileId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PositionService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  private org(path: string): string {
    return `${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}${path}`;
  }

  list(): Observable<OrgPosition[]> {
    return this.http.get<OrgPosition[]>(this.org('/positions'));
  }

  create(payload: PositionPatch & { name: string }): Observable<OrgPosition> {
    return this.http.post<OrgPosition>(this.org('/positions'), payload);
  }

  update(positionId: string, patch: PositionPatch): Observable<OrgPosition> {
    return this.http.patch<OrgPosition>(`${API_BASE_URL}/positions/${positionId}`, patch);
  }

  remove(positionId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/positions/${positionId}`);
  }

  // --- organizacne zlozky (#12 strom) ---

  listUnits(): Observable<OrgUnit[]> {
    return this.http.get<OrgUnit[]>(this.org('/units'));
  }

  createUnit(payload: { name: string; description: string; parentId: string | null }): Observable<OrgUnit> {
    return this.http.post<OrgUnit>(this.org('/units'), payload);
  }

  updateUnit(unitId: string, patch: { name?: string; description?: string; parentId?: string | null }): Observable<OrgUnit> {
    return this.http.patch<OrgUnit>(`${API_BASE_URL}/units/${unitId}`, patch);
  }

  removeUnit(unitId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/units/${unitId}`);
  }

  // --- obsadenie miest (#14) ---

  assign(positionId: string, personId: string, validFrom?: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${API_BASE_URL}/positions/${positionId}/assignments`, { personId, validFrom });
  }

  /** Ukoncenie obsadenia — validTo je posledny den; zaznam ostava v historii. */
  endAssignment(assignmentId: string, validTo: string): Observable<unknown> {
    return this.http.patch(`${API_BASE_URL}/assignments/${assignmentId}`, { validTo });
  }

  /** Len pre omylom zadane obsadenie. */
  deleteAssignment(assignmentId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/assignments/${assignmentId}`);
  }
}

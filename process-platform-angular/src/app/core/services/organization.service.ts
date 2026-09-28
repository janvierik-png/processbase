import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { JobProfile, Person } from '../models/user.model';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

export interface PersonPayload {
  name?: string;
  email?: string;
  phone?: string;
  note?: string;
  active?: boolean;
}

export interface LeaveResult {
  person: Person;
  endedAssignments: number;
  /** miesta, ktore po odchode nikto nezastava */
  vacatedPositions: Array<{ id: string; name: string }>;
}

/** Adresar osob (#13) a profily prace (#16). */
@Injectable({ providedIn: 'root' })
export class OrganizationService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  private org(path: string): string {
    return `${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}${path}`;
  }

  // --- osoby ---

  people(): Observable<Person[]> {
    return this.http.get<Person[]>(this.org('/people'));
  }

  createPerson(payload: PersonPayload & { name: string }): Observable<Person> {
    return this.http.post<Person>(this.org('/people'), payload);
  }

  updatePerson(personId: string, patch: PersonPayload): Observable<Person> {
    return this.http.patch<Person>(`${API_BASE_URL}/people/${personId}`, patch);
  }

  deletePerson(personId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/people/${personId}`);
  }

  /** Odchod: ukonci obsadenia k datumu (posledny den) a osobu deaktivuje. */
  leave(personId: string, date: string): Observable<LeaveResult> {
    return this.http.post<LeaveResult>(`${API_BASE_URL}/people/${personId}/leave`, { date });
  }

  // --- profily prace a verzie popisu ---

  jobProfiles(): Observable<JobProfile[]> {
    return this.http.get<JobProfile[]>(this.org('/job-profiles'));
  }

  jobProfile(id: string): Observable<JobProfile> {
    return this.http.get<JobProfile>(`${API_BASE_URL}/job-profiles/${id}`);
  }

  createJobProfile(name: string, summary: string): Observable<JobProfile> {
    return this.http.post<JobProfile>(this.org('/job-profiles'), { name, summary });
  }

  updateJobProfile(id: string, patch: { name?: string; summary?: string }): Observable<JobProfile> {
    return this.http.patch<JobProfile>(`${API_BASE_URL}/job-profiles/${id}`, patch);
  }

  deleteJobProfile(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/job-profiles/${id}`);
  }

  createDraft(profileId: string, content: string): Observable<{ id: string; version: number }> {
    return this.http.post<{ id: string; version: number }>(`${API_BASE_URL}/job-profiles/${profileId}/versions`, { content });
  }

  saveDraft(versionId: string, content: string): Observable<unknown> {
    return this.http.patch(`${API_BASE_URL}/job-description-versions/${versionId}`, { content });
  }

  publish(versionId: string, effectiveFrom: string): Observable<unknown> {
    return this.http.post(`${API_BASE_URL}/job-description-versions/${versionId}/publish`, { effectiveFrom });
  }

  deleteDraft(versionId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/job-description-versions/${versionId}`);
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ProcessFieldDefinition, ProcessFieldType } from '../models/organization.model';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

export interface ProcessFieldPayload {
  label?: string;
  type?: ProcessFieldType;
  options?: string[];
  required?: boolean;
  helpText?: string;
  archived?: boolean;
}

/** #45 — vlastné polia procesu v nastaveniach firmy. */
@Injectable({ providedIn: 'root' })
export class ProcessFieldService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  private org(path: string): string {
    return `${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}${path}`;
  }

  list(): Observable<ProcessFieldDefinition[]> {
    return this.http.get<ProcessFieldDefinition[]>(this.org('/process-fields'));
  }

  create(payload: ProcessFieldPayload & { label: string; type: ProcessFieldType }): Observable<ProcessFieldDefinition> {
    return this.http.post<ProcessFieldDefinition>(this.org('/process-fields'), payload);
  }

  update(fieldId: string, patch: ProcessFieldPayload): Observable<ProcessFieldDefinition> {
    return this.http.patch<ProcessFieldDefinition>(`${API_BASE_URL}/process-fields/${fieldId}`, patch);
  }

  reorder(ids: string[]): Observable<void> {
    return this.http.put<void>(this.org('/process-fields/order'), { ids });
  }

  /** Pole s hodnotami server len archivuje (odpoveď s archived: true), inak ho zmaže (204). */
  remove(fieldId: string): Observable<(ProcessFieldDefinition & { message?: string }) | null> {
    return this.http.delete<(ProcessFieldDefinition & { message?: string }) | null>(`${API_BASE_URL}/process-fields/${fieldId}`);
  }
}

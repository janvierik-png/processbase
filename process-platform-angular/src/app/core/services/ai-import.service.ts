import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AiSettings, AiStatus, AnalyzeResult, ApplyPayload, ApplyResult, DraftResult } from '../models/import.model';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

/** #42 AI-01 / #41 IMP-01 — AI asistent, návrh procesu z textu a import dokumentov. */
@Injectable({ providedIn: 'root' })
export class AiImportService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  settings(): Observable<AiSettings> {
    return this.http.get<AiSettings>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/settings/ai`);
  }

  saveSettings(payload: { enabled?: boolean; apiKey?: string; removeKey?: boolean }): Observable<AiSettings> {
    return this.http.post<AiSettings>(`${API_BASE_URL}/organizations/${this.auth.currentOrganizationId()}/settings/ai`, payload);
  }

  status(): Observable<AiStatus> {
    return this.http.get<AiStatus>(`${API_BASE_URL}/ai/status`);
  }

  draftFromText(text: string, useAi: boolean): Observable<DraftResult> {
    return this.http.post<DraftResult>(`${API_BASE_URL}/process-drafts/from-text`, { text, useAi });
  }

  /** Súbor ide ako telo požiadavky; server ho neukladá. */
  analyze(file: File, useAi: boolean): Observable<AnalyzeResult> {
    const headers = new HttpHeaders({ 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) });
    return this.http.post<AnalyzeResult>(`${API_BASE_URL}/import/analyze${useAi ? '?ai=1' : ''}`, file, { headers });
  }

  apply(payload: ApplyPayload): Observable<ApplyResult> {
    return this.http.post<ApplyResult>(`${API_BASE_URL}/import/apply`, payload);
  }
}

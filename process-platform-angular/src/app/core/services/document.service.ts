import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Attachment } from '../models/process.model';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService
  ) {}

  listAll() {
    const organizationId = this.auth.currentOrganizationId();
    return this.http.get<Attachment[]>(`${API_BASE_URL}/organizations/${organizationId}/documents`);
  }

  listForProcess(processId: string) {
    return this.http.get<Attachment[]>(`${API_BASE_URL}/processes/${processId}/documents`);
  }

  upload(processId: string, file: File, dataUrl: string) {
    return this.http.post<Attachment>(`${API_BASE_URL}/processes/${processId}/documents`, {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      dataUrl
    });
  }

  update(id: string, patch: { name?: string; positionIds?: string[] }) {
    return this.http.patch<Attachment>(`${API_BASE_URL}/documents/${id}`, patch);
  }

  delete(id: string) {
    return this.http.delete<void>(`${API_BASE_URL}/documents/${id}`);
  }
}

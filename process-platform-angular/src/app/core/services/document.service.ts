import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Attachment } from '../models/process.model';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api-url';

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number;
  documentCount: number;
}

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

  /** Obsadenost uloziska firmy (#8) — rata sa skutocna velkost suborov. */
  storage() {
    const organizationId = this.auth.currentOrganizationId();
    return this.http.get<StorageUsage>(`${API_BASE_URL}/organizations/${organizationId}/storage`);
  }

  /**
   * Nahratie suboru (#10) — telo je priamo subor, nie base64 v JSON, takze
   * 100 MB subor sa nenacitava do pamate a na sieti nie je o tretinu vacsi.
   * Content-Type je vzdy octet-stream: napr. .json subor by inak server
   * rozparsoval ako JSON. Skutocny typ ide v X-File-Type.
   */
  upload(processId: string, file: File) {
    return this.http.post<Attachment>(`${API_BASE_URL}/processes/${processId}/documents`, file, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': file.type || 'application/octet-stream'
      }
    });
  }

  /** URL suboru — len pre href odkazu; samotne stiahnutie ide cez download(). */
  downloadUrl(id: string): string {
    return `${API_BASE_URL}/documents/${id}/download`;
  }

  /**
   * Obsah suboru ako Blob. Ide cez HttpClient, takze nesie Authorization
   * hlavicku (#1) — obycajny <a href> alebo <iframe src> by token neposlal
   * a server by vratil 401. Token v URL nechceme (logy, referer).
   */
  fetchFile(id: string, inline = false): Observable<Blob> {
    return this.http.get(`${this.downloadUrl(id)}${inline ? '?inline=1' : ''}`, { responseType: 'blob' });
  }

  /** Stiahne subor pod jeho nazvom. */
  download(id: string, fileName: string): Observable<void> {
    return this.fetchFile(id).pipe(map((blob) => saveBlob(blob, fileName)));
  }

  update(id: string, patch: { name?: string; positionIds?: string[] }) {
    return this.http.patch<Attachment>(`${API_BASE_URL}/documents/${id}`, patch);
  }

  delete(id: string) {
    return this.http.delete<void>(`${API_BASE_URL}/documents/${id}`);
  }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // prehliadac si subor prevezme asynchronne — URL uvolnime az po chvili
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

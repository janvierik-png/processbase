import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { API_BASE_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class Camunda7Service {
  constructor(private readonly http: HttpClient) {}

  deploy(processId: string, deploymentName: string, bpmnXml: string) {
    return this.http.post(`${API_BASE_URL}/camunda7/deploy`, {
      processId,
      deploymentName,
      resourceName: `${processId}.bpmn`,
      bpmnXml,
      deployChangedOnly: true
    });
  }
}

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DestinationsService {
  private base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  list() {
    return this.http.get<any[]>(`${this.base}/destinations`);
  }

  create(payload: { title: string; location?: string }) {
    return this.http.post<any>(`${this.base}/destinations`, payload);
  }

  get(id: string) {
    return this.http.get<any>(`${this.base}/destinations/${id}`);
  }

  update(id: string, payload: { title: string; location?: string }) {
    return this.http.patch<any>(`${this.base}/destinations/${id}`, payload);
  }

  addMember(id: string, payload: { email: string; role: 'ADMIN' | 'MEMBER' }) {
    return this.http.post<any>(`${this.base}/destinations/${id}/members`, payload);
  }

  updateMemberRole(id: string, userId: string, role: 'ADMIN' | 'MEMBER') {
    return this.http.patch<any>(`${this.base}/destinations/${id}/members/${userId}/role`, { role });
  }

  removeMember(id: string, userId: string) {
    return this.http.delete<any>(`${this.base}/destinations/${id}/members/${userId}`);
  }

  delete(id: string) {
    return this.http.delete<any>(`${this.base}/destinations/${id}`);
  }
}

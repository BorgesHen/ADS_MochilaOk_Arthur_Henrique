import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ItemsService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  list(destinationId: string) {
    return this.http.get<any[]>(
      `${this.base}/destinations/${destinationId}/items`
    );
  }

  create(destinationId: string, payload: any) {
    return this.http.post<any>(
      `${this.base}/destinations/${destinationId}/items`,
      payload
    );
  }

  update(itemId: string, payload: any) {
    return this.http.patch<any>(
      `${this.base}/items/${itemId}`,
      payload
    );
  }

  delete(itemId: string) {
    return this.http.delete<any>(
      `${this.base}/items/${itemId}`
    );
  }

  setStatus(itemId: string, status: 'PENDING' | 'DONE') {
    return this.http.patch<any>(
      `${this.base}/items/${itemId}/status`,
      { status }
    );
  }

  claim(itemId: string, claimed: boolean) {
    return this.http.patch<any>(
      `${this.base}/items/${itemId}/claim`,
      { claimed }
    );
  }
}
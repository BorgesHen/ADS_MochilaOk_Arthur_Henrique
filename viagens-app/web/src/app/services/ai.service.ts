import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../environments/environment';

export type AiSuggestionsPayload = {
  days?: string;
  budget?: string;
  travelStyle?: string;
  interests?: string[];
};

@Injectable({ providedIn: 'root' })
export class AiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  getDestinationSuggestions(
    destinationId: string,
    payload: AiSuggestionsPayload
  ) {
    return this.http.post<any>(
      `${this.base}/destinations/${destinationId}/ai/suggestions`,
      payload
    );
  }
}
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { timeout } from 'rxjs';

import { environment } from '../../environments/environment';

export type AiSuggestionsPayload = {
  days?: string;
  budget?: string;
  travelStyle?: string;
  interests?: string[];
};

export type AiPlace = {
  placeId?: string | null;
  name?: string | null;
  address?: string | null;
  rating?: number | null;
  googleMapsUri?: string | null;
  photoName?: string | null;
  photoUrl?: string | null;
  photoAttributions?: {
    displayName?: string;
    uri?: string;
    photoUri?: string;
  }[];
};

export type AiSuggestionItem = {
  name: string;
  details: string;
  tag?: string;
  searchQuery?: string;
  place?: AiPlace | null;
};

export type AiSuggestionSection = {
  title: string;
  description: string;
  items: AiSuggestionItem[];
};

export type AiSuggestionsResponse = {
  destination: {
    id: string;
    title: string;
    location?: string;
  };
  answer: string;
  sections: AiSuggestionSection[];
  sources: {
    title: string;
    uri: string;
  }[];
};

@Injectable({ providedIn: 'root' })
export class AiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  getDestinationSuggestions(
    destinationId: string,
    payload: AiSuggestionsPayload
  ) {
    return this.http
      .post<AiSuggestionsResponse>(
        `${this.base}/destinations/${destinationId}/ai/suggestions`,
        payload
      )
      .pipe(timeout(60000));
  }
}
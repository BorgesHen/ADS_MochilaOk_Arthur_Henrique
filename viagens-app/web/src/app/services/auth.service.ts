import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { TokenService } from './token.service';

type AuthResponse = {
  user: any;
  token: string;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private token = inject(TokenService);
  private base = environment.apiUrl;

  login(payload: { email: string; password: string }) {
    return this.http.post<AuthResponse>(`${this.base}/auth/login`, payload).pipe(
      tap((r) => this.token.set(r.token))
    );
  }

  register(payload: { name: string; email: string; password: string }) {
    return this.http.post<AuthResponse>(`${this.base}/auth/register`, payload).pipe(
      tap((r) => this.token.set(r.token))
    );
  }

  logout() {
    this.token.clear();
  }

  isLoggedIn() {
    return this.token.isLoggedIn();
  }
}
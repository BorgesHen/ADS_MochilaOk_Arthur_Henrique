import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { Subscription, filter } from 'rxjs';

import { DestinationsService } from '../../services/destinations.service';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-destinations',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './destinations.component.html',
})
export class DestinationsComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private api = inject(DestinationsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cdr = inject(ChangeDetectorRef);
  public auth = inject(AuthService);

  destinations: any[] = [];
  error: string | null = null;
  showForm = false;
  loading = false;
  loadingList = false;

  private routeEventsSub?: Subscription;
  private queryParamsSub?: Subscription;

  form = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    location: [''],
  });

  ngOnInit() {
    this.load();

    this.routeEventsSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = event.urlAfterRedirects.split('?')[0];

        if (url === '/destinations') {
          this.load({ silent: true });
        }
      });

    this.queryParamsSub = this.route.queryParamMap.subscribe((params) => {
      if (params.has('refresh')) {
        this.load({ silent: true });
      }
    });
  }

  ngOnDestroy() {
    this.routeEventsSub?.unsubscribe();
    this.queryParamsSub?.unsubscribe();
  }

  private refreshView() {
    // O projeto está rodando em Angular sem Zone.js. Sem esta chamada,
    // os dados chegam da API, mas a tela só atualiza depois de algum clique.
    this.cdr.detectChanges();
  }

  load(options: { silent?: boolean } = {}) {
    if (!options.silent) {
      this.error = null;
    }

    this.loadingList = true;
    this.refreshView();

    this.api.list().subscribe({
      next: (r: any[]) => {
        this.destinations = Array.isArray(r) ? r : [];
        this.loadingList = false;
        this.refreshView();
      },
      error: (e: any) => {
        this.loadingList = false;
        this.error = e?.error?.error ?? 'Erro ao carregar viagens';
        this.refreshView();
      },
    });
  }

  openCreateForm() {
    this.showForm = true;
  }

  cancelCreate() {
    this.showForm = false;
    this.form.reset({
      title: '',
      location: '',
    });
  }

  create() {
    this.error = null;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    this.refreshView();

    this.api.create(this.form.getRawValue() as any).subscribe({
      next: (created: any) => {
        this.loading = false;
        this.form.reset({
          title: '',
          location: '',
        });
        this.showForm = false;
        this.refreshView();

        this.router.navigate(['/destinations', created.id]);
      },
      error: (e: any) => {
        this.loading = false;
        this.error = e?.error?.error ?? 'Erro ao criar viagem';
        this.refreshView();
      },
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}

import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, take } from 'rxjs';

import { environment } from '../../../environments/environment';

import { DestinationsService } from '../../services/destinations.service';
import { CategoriesService } from '../../services/categories.service';
import { ItemsService } from '../../services/items.service';
import { AiService } from '../../services/ai.service';

type CategoryMode = 'PER_USER' | 'CLAIMABLE';

@Component({
  standalone: true,
  selector: 'app-destination-detail',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './destination-detail.html',
  styleUrl: './destination-detail.scss',
})
export class DestinationDetail implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);

  private destinationsApi = inject(DestinationsService);
  private categoriesApi = inject(CategoriesService);
  private itemsApi = inject(ItemsService);
  private aiApi = inject(AiService);

  destinationId = '';
  destination: any = null;
  members: any[] = [];
  categories: any[] = [];
  items: any[] = [];

  loadingDestination = true;
  error: string | null = null;
  success: string | null = null;

  categoryLoading = false;
  itemLoading = false;
  quickItemLoading = false;
  inviteLoading = false;
  activeItemLoadingId: string | null = null;

  showInviteForm = false;
  showCategoryForm = false;
  showItemForm = false;
  quickItemCategoryId: string | null = null;

  private itemsPolling: ReturnType<typeof setInterval> | null = null;

  inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['MEMBER', [Validators.required]],
  });

  categoryForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    mode: ['PER_USER', [Validators.required]],
    sort_order: [0],
  });

  itemForm = this.fb.group({
    category_id: ['', [Validators.required]],
    title: ['', [Validators.required, Validators.minLength(2)]],
    qty: [1],
    unit: [''],
    notes: [''],
  });

  quickItemForm = this.fb.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    qty: [1],
    unit: [''],
    notes: [''],
  });

  // Configuração IA
  apiUrl = environment.apiUrl.replace(/\/$/, '');

  aiLoading = false;
  aiError: string | null = null;
  aiAnswer: string | null = null;
  aiSources: any[] = [];
  aiSections: any[] = [];
  aiFocus: any = null;

  aiForm = this.fb.group({
    days: [''],
    budget: ['moderado'],
    travelStyle: ['equilibrado'],
    interests: [''],
  });

  ngOnInit() {
    this.destinationId = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadAll();
    this.startItemsPolling();
  }

  ngOnDestroy() {
    if (this.itemsPolling) {
      clearInterval(this.itemsPolling);
      this.itemsPolling = null;
    }
  }

  private refreshView() {
    this.cdr.detectChanges();
  }

  private startItemsPolling() {
    if (this.itemsPolling) {
      clearInterval(this.itemsPolling);
    }

    this.itemsPolling = setInterval(() => {
      if (!this.destinationId) return;

      this.loadItems(true);
    }, 10000);
  }

  clearMessages() {
    this.error = null;
    this.success = null;
  }

  goToDestinations(event?: Event) {
    event?.preventDefault();

    this.router.navigate(['/destinations'], {
      queryParams: { refresh: Date.now() },
    });
  }

  isAdmin() {
    return this.destination?.is_admin === true || this.destination?.my_role === 'ADMIN';
  }

  roleLabel(role?: string | null) {
    if (!role) return this.loadingDestination ? 'Carregando...' : 'Convidado';

    return role === 'ADMIN' ? 'Administrador' : 'Convidado';
  }

  modeLabel(mode?: string | null) {
    return mode === 'PER_USER' ? 'Checklist por pessoa' : 'Item assumível';
  }

  /**
   * Define se o item deve aparecer visualmente como feito.
   *
   * Regra usada no quadro:
   * - O status visual do card é GLOBAL para todos os participantes.
   * - Se qualquer usuário marcou o item como feito, o card aparece como feito.
   * - O status individual do usuário logado fica em my_status e controla os botões
   *   "Marcar como feito" / "Desmarcar meu feito".
   */
  isItemDoneForView(item: any) {
    return item?.global_status === 'DONE';
  }

  statusLabel(item: any) {
    if (this.isItemDoneForView(item)) {
      return 'Feito';
    }

    if (item.category_mode === 'CLAIMABLE') {
      if (item.claimed_by_name || item.claimed_by_email) {
        return 'Assumido';
      }

      return 'Disponível';
    }

    return 'Pendente';
  }

  isItemClaimedByOther(item: any) {
    return (
      item.category_mode === 'CLAIMABLE' &&
      Boolean(item.claimed_by_id) &&
      !item.my_claimed
    );
  }

  doneByUsers(item: any) {
    if (Array.isArray(item?.done_by_users)) {
      return item.done_by_users;
    }

    if (typeof item?.done_by_users === 'string') {
      try {
        const parsed = JSON.parse(item.done_by_users);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    return [];
  }

  currentUserDone(item: any) {
    const users = this.doneByUsers(item);

    const explicitCurrentUser = users.find(
      (user: any) => user.is_current_user === true
    );

    if (explicitCurrentUser) {
      return explicitCurrentUser;
    }

    /**
     * Fallback para versões do backend sem is_current_user:
     * se o backend diz que my_status = DONE, o usuário logado marcou o item,
     * mesmo que não dê para identificar o nome dele dentro de done_by_users.
     */
    if (item?.my_status === 'DONE') {
      return {
        id: null,
        name: 'você',
        email: null,
        is_current_user: true,
      };
    }

    return null;
  }

  /**
   * Mensagens exibidas no card.
   *
   * ADMIN:
   * - vê uma mensagem por usuário que marcou o item.
   * - Ex.: "Feito por você", "Feito por Arthur".
   * - Se a marcação for do próprio admin, mostra "Feito por você" em vez do
   *   nome dele, mesma regra usada para o convidado.
   *
   * CONVIDADO:
   * - se ele marcou, vê somente "Feito por você".
   * - se outro participante marcou e ele ainda não marcou, vê quem marcou,
   *   para que a atualização continue visível para todos.
   */
  doneMessages(item: any) {
    const users = this.doneByUsers(item);

    if (users.length === 0) {
      return [];
    }

    if (this.isAdmin()) {
      return users.map((user: any) => ({
        label: user.is_current_user
          ? 'Feito por você'
          : `Feito por ${user.name || user.email}`,
        user,
      }));
    }

    const currentUser = this.currentUserDone(item);

    if (currentUser) {
      return [
        {
          label: 'Feito por você',
          user: currentUser,
        },
      ];
    }

    return users.map((user: any) => ({
      label: `Feito por ${user.name || user.email}`,
      user,
    }));
  }

  doneMessagesTitle(item: any) {
    if (this.isAdmin()) {
      return 'Marcações realizadas:';
    }

    if (item?.my_status === 'DONE' || this.currentUserDone(item)) {
      return 'Sua marcação:';
    }

    return 'Marcado por:';
  }

  /**
   * Texto do badge no topo do card.
   */
  doneStatusBadgeText(item: any) {
    if (!this.isItemDoneForView(item)) {
      return this.statusLabel(item);
    }

    const messages = this.doneMessages(item);

    if (this.isAdmin()) {
      if (messages.length === 1) {
        return messages[0].label;
      }

      if (messages.length > 1) {
        return `${messages.length} marcações`;
      }

      return 'Feito';
    }

    if (item?.my_status === 'DONE') {
      return 'Feito por você';
    }

    if (messages.length === 1) {
      return messages[0].label;
    }

    if (messages.length > 1) {
      return `${messages.length} marcações`;
    }

    return 'Feito';
  }

  doneByText(item: any) {
    const messages = this.doneMessages(item);

    if (messages.length === 0) {
      return '';
    }

    if (this.isAdmin()) {
      if (messages.length === 1) {
        return messages[0].label;
      }

      return `${messages.length} participantes marcaram este item como feito.`;
    }

    if (item?.my_status === 'DONE') {
      return 'Você marcou este checklist como feito.';
    }

    if (messages.length === 1) {
      return messages[0].label;
    }

    return `${messages.length} participantes marcaram este item como feito.`;
  }

  responsibleText(item: any) {
    if (item.category_mode === 'CLAIMABLE') {
      if (item.claimed_by_name || item.claimed_by_email) {
        return `Responsável: ${item.claimed_by_name || item.claimed_by_email}`;
      }

      return 'Disponível para alguém assumir.';
    }

    const doneText = this.doneByText(item);

    if (doneText) {
      return doneText;
    }

    return 'Cada participante marca se já fez esta tarefa.';
  }

  canUserChangeItemStatus(item: any) {
    if (item.category_mode === 'CLAIMABLE') {
      return item.my_claimed === true;
    }

    return true;
  }

  private openInitialAdminFormsIfNeeded() {
    if (
      this.isAdmin() &&
      this.categories.length === 0 &&
      !this.showCategoryForm &&
      !this.showItemForm &&
      !this.showInviteForm
    ) {
      this.showCategoryForm = true;
    }
  }

  loadAll(options: { keepMessages?: boolean } = {}) {
    if (!options.keepMessages) {
      this.clearMessages();
    }

    this.loadingDestination = true;
    this.refreshView();

    this.destinationsApi.get(this.destinationId).subscribe({
      next: (r: any) => {
        this.destination = r.destination;
        this.members = Array.isArray(r.members) ? r.members : [];
        this.loadingDestination = false;
        this.openInitialAdminFormsIfNeeded();
        this.refreshView();
      },
      error: (e: any) => {
        this.loadingDestination = false;
        this.error = e?.error?.error ?? 'Erro ao carregar viagem';
        this.refreshView();
      },
    });

    this.loadCategories();
    this.loadItems();
  }

  loadCategories() {
    this.categoriesApi.list(this.destinationId).subscribe({
      next: (r: any[]) => {
        this.categories = Array.isArray(r) ? r : [];
        this.openInitialAdminFormsIfNeeded();
        this.refreshView();
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao carregar categorias';
        this.refreshView();
      },
    });
  }

  loadItems(silent = false) {
    if (!silent) {
      this.error = null;
    }

    this.itemsApi.list(this.destinationId).subscribe({
      next: (r: any[]) => {
        this.items = Array.isArray(r) ? r : [];
        this.refreshView();
      },
      error: (e: any) => {
        if (!silent) {
          this.error = e?.error?.error ?? 'Erro ao carregar itens';
        }

        this.refreshView();
      },
    });
  }

  itemsByCategory(categoryId: string) {
    return this.items.filter((item) => item.category_id === categoryId);
  }

  openInviteForm() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode convidar pessoas.';
      this.refreshView();
      return;
    }

    this.showInviteForm = true;
    this.refreshView();
  }

  closeInviteForm() {
    this.showInviteForm = false;
    this.inviteForm.reset({ email: '', role: 'MEMBER' });
    this.refreshView();
  }

  openCategoryForm() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode criar categorias.';
      this.refreshView();
      return;
    }

    this.showCategoryForm = true;
    this.refreshView();
  }

  closeCategoryForm() {
    this.showCategoryForm = false;
    this.categoryForm.reset({ name: '', mode: 'PER_USER', sort_order: 0 });
    this.refreshView();
  }

  openItemForm(categoryId?: string) {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode criar itens.';
      this.refreshView();
      return;
    }

    if (this.categories.length === 0) {
      this.error = 'Crie uma categoria antes de adicionar itens.';
      this.openCategoryForm();
      return;
    }

    if (categoryId) {
      this.itemForm.patchValue({ category_id: categoryId });
    }

    this.showItemForm = true;
    this.refreshView();
  }

  closeItemForm() {
    this.showItemForm = false;
    this.itemForm.reset({
      category_id: '',
      title: '',
      qty: 1,
      unit: '',
      notes: '',
    });
    this.refreshView();
  }

  openItemFormForCategory(category: any) {
    this.openItemForm(category.id);
  }

  openQuickItemForm(category: any) {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode adicionar itens.';
      this.refreshView();
      return;
    }

    this.quickItemCategoryId = category.id;
    this.quickItemForm.reset({ title: '', qty: 1, unit: '', notes: '' });
    this.refreshView();
  }

  closeQuickItemForm() {
    this.quickItemCategoryId = null;
    this.quickItemForm.reset({ title: '', qty: 1, unit: '', notes: '' });
    this.refreshView();
  }

  createQuickItem(category: any) {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode adicionar itens.';
      this.refreshView();
      return;
    }

    if (this.quickItemForm.invalid) {
      this.quickItemForm.markAllAsTouched();
      this.refreshView();
      return;
    }

    const payload = {
      ...this.quickItemForm.getRawValue(),
      category_id: category.id,
    };

    this.quickItemLoading = true;
    this.refreshView();

    this.itemsApi.create(this.destinationId, payload as any).subscribe({
      next: () => {
        this.quickItemLoading = false;
        this.success = `Item adicionado na lista ${category.name}.`;
        this.quickItemForm.reset({ title: '', qty: 1, unit: '', notes: '' });
        this.quickItemCategoryId = category.id;
        this.refreshView();
        this.loadItems();
      },
      error: (e: any) => {
        this.quickItemLoading = false;
        this.error = e?.error?.error ?? 'Erro ao adicionar item';
        this.refreshView();
      },
    });
  }

  inviteMember() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode convidar pessoas.';
      this.refreshView();
      return;
    }

    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      this.refreshView();
      return;
    }

    this.inviteLoading = true;
    this.refreshView();

    this.destinationsApi.addMember(this.destinationId, this.inviteForm.getRawValue() as any).subscribe({
      next: () => {
        this.inviteLoading = false;
        this.success = 'Pessoa adicionada à viagem.';
        this.inviteForm.reset({ email: '', role: 'MEMBER' });
        this.showInviteForm = true;
        this.refreshView();
        this.loadAll({ keepMessages: true });
      },
      error: (e: any) => {
        this.inviteLoading = false;
        this.error = e?.error?.error ?? 'Erro ao convidar pessoa';
        this.refreshView();
      },
    });
  }

  changeMemberRole(member: any, role: 'ADMIN' | 'MEMBER') {
    this.clearMessages();

    if (member.role === role) return;

    this.destinationsApi.updateMemberRole(this.destinationId, member.user_id, role).subscribe({
      next: () => {
        this.success = 'Permissão atualizada.';
        this.refreshView();
        this.loadAll({ keepMessages: true });
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao alterar permissão';
        this.refreshView();
      },
    });
  }

  removeMember(member: any) {
    this.clearMessages();

    const confirmed = window.confirm(`Remover ${member.name || member.email} desta viagem?`);
    if (!confirmed) return;

    this.destinationsApi.removeMember(this.destinationId, member.user_id).subscribe({
      next: () => {
        this.success = 'Membro removido da viagem.';
        this.refreshView();
        this.loadAll({ keepMessages: true });
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao remover membro';
        this.refreshView();
      },
    });
  }

  editDestination() {
    this.clearMessages();

    const title = window.prompt('Título da viagem', this.destination?.title ?? '');
    if (title === null) return;

    const location = window.prompt('Destino/local da viagem', this.destination?.location ?? '');
    if (location === null) return;

    this.destinationsApi.update(this.destinationId, { title, location }).subscribe({
      next: () => {
        this.success = 'Viagem atualizada.';
        this.refreshView();
        this.loadAll({ keepMessages: true });
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao atualizar viagem';
        this.refreshView();
      },
    });
  }

  deleteDestination() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode excluir esta viagem.';
      this.refreshView();
      return;
    }

    const title = this.destination?.title || 'esta viagem';
    const confirmed = window.confirm(
      `Excluir a viagem "${title}"? Esta ação remove categorias, itens, responsáveis e membros da viagem. Não é possível desfazer.`
    );

    if (!confirmed) return;

    this.loadingDestination = true;
    this.refreshView();

    this.destinationsApi.delete(this.destinationId).subscribe({
      next: () => {
        this.loadingDestination = false;
        this.router.navigate(['/destinations'], {
          queryParams: { refresh: Date.now(), deleted: '1' },
        });
      },
      error: (e: any) => {
        this.loadingDestination = false;
        this.error = e?.error?.error ?? 'Erro ao excluir viagem';
        this.refreshView();
      },
    });
  }

  createCategory() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode criar categorias.';
      this.refreshView();
      return;
    }

    if (this.categoryForm.invalid) {
      this.categoryForm.markAllAsTouched();
      this.refreshView();
      return;
    }

    this.categoryLoading = true;
    this.refreshView();

    this.categoriesApi.create(this.destinationId, this.categoryForm.getRawValue() as any).subscribe({
      next: (created: any) => {
        this.categoryLoading = false;
        this.success = 'Categoria criada. Agora você já pode adicionar itens nela.';
        this.categoryForm.reset({
          name: '',
          mode: 'PER_USER',
          sort_order: 0,
        });
        this.showCategoryForm = false;
        this.showItemForm = true;
        this.itemForm.patchValue({ category_id: created.id });
        this.refreshView();
        this.loadCategories();
      },
      error: (e: any) => {
        this.categoryLoading = false;
        this.error = e?.error?.error ?? 'Erro ao criar categoria';
        this.refreshView();
      },
    });
  }

  editCategory(category: any) {
    this.clearMessages();

    const name = window.prompt('Nome da categoria', category.name);
    if (name === null) return;

    const modeInput = window.prompt('Modo da categoria: PER_USER ou CLAIMABLE', category.mode);
    if (modeInput === null) return;

    const mode = modeInput.trim().toUpperCase() as CategoryMode;

    if (mode !== 'PER_USER' && mode !== 'CLAIMABLE') {
      this.error = 'Modo inválido. Use PER_USER ou CLAIMABLE.';
      this.refreshView();
      return;
    }

    const sortInput = window.prompt('Ordem da categoria', String(category.sort_order ?? 0));
    if (sortInput === null) return;

    const sort_order = Number(sortInput);

    this.categoriesApi.update(this.destinationId, category.id, { name, mode, sort_order }).subscribe({
      next: () => {
        this.success = 'Categoria atualizada.';
        this.refreshView();
        this.loadCategories();
        this.loadItems();
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao atualizar categoria';
        this.refreshView();
      },
    });
  }

  deleteCategory(category: any) {
    this.clearMessages();

    const confirmed = window.confirm(
      `Excluir a categoria "${category.name}" e todos os itens dentro dela?`
    );

    if (!confirmed) return;

    this.categoriesApi.delete(this.destinationId, category.id).subscribe({
      next: () => {
        this.success = 'Categoria excluída.';

        if (this.quickItemCategoryId === category.id) {
          this.closeQuickItemForm();
        }

        this.refreshView();
        this.loadCategories();
        this.loadItems();
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao excluir categoria';
        this.refreshView();
      },
    });
  }

  createItem() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode criar itens.';
      this.refreshView();
      return;
    }

    if (this.itemForm.invalid) {
      this.itemForm.markAllAsTouched();
      this.refreshView();
      return;
    }

    this.itemLoading = true;
    this.refreshView();

    const selectedCategory = this.itemForm.get('category_id')?.value ?? '';

    this.itemsApi.create(this.destinationId, this.itemForm.getRawValue() as any).subscribe({
      next: () => {
        this.itemLoading = false;
        this.success = 'Item criado. Você pode continuar adicionando itens na mesma categoria.';
        this.itemForm.reset({
          category_id: selectedCategory,
          title: '',
          qty: 1,
          unit: '',
          notes: '',
        });
        this.showItemForm = true;
        this.refreshView();
        this.loadItems();
      },
      error: (e: any) => {
        this.itemLoading = false;
        this.error = e?.error?.error ?? 'Erro ao criar item';
        this.refreshView();
      },
    });
  }

  editItem(item: any) {
    this.clearMessages();

    const title = window.prompt('Nome do item', item.title);
    if (title === null) return;

    const qtyInput = window.prompt('Quantidade', item.qty == null ? '' : String(item.qty));
    if (qtyInput === null) return;

    const unit = window.prompt('Unidade', item.unit ?? '');
    if (unit === null) return;

    const notes = window.prompt('Observações', item.notes ?? '');
    if (notes === null) return;

    const qty = qtyInput.trim() === '' ? null : Number(qtyInput);

    if (qtyInput.trim() !== '' && Number.isNaN(qty)) {
      this.error = 'Quantidade inválida.';
      this.refreshView();
      return;
    }

    this.itemsApi
      .update(item.id, {
        category_id: item.category_id,
        title,
        qty,
        unit,
        notes,
      })
      .subscribe({
        next: () => {
          this.success = 'Item atualizado.';
          this.refreshView();
          this.loadItems();
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Erro ao atualizar item';
          this.refreshView();
        },
      });
  }

  deleteItem(item: any) {
    this.clearMessages();

    const confirmed = window.confirm(`Excluir o item "${item.title}"?`);
    if (!confirmed) return;

    this.itemsApi.delete(item.id).subscribe({
      next: () => {
        this.success = 'Item excluído.';
        this.refreshView();
        this.loadItems();
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao excluir item';
        this.refreshView();
      },
    });
  }

  markDone(item: any) {
    this.clearMessages();

    if (!this.canUserChangeItemStatus(item)) {
      this.error = 'Assuma este item antes de marcar como feito.';
      this.refreshView();
      return;
    }

    this.activeItemLoadingId = item.id;
    this.refreshView();

    this.itemsApi.setStatus(item.id, 'DONE').subscribe({
      next: () => {
        this.activeItemLoadingId = null;
        this.success = 'Item marcado como feito.';
        this.refreshView();
        this.loadItems();
      },
      error: (e: any) => {
        this.activeItemLoadingId = null;
        this.error = e?.error?.error ?? 'Erro ao atualizar item';
        this.refreshView();
      },
    });
  }

  markPending(item: any) {
    this.clearMessages();

    if (!this.canUserChangeItemStatus(item)) {
      this.error = 'Assuma este item antes de alterar o status.';
      this.refreshView();
      return;
    }

    this.activeItemLoadingId = item.id;
    this.refreshView();

    this.itemsApi.setStatus(item.id, 'PENDING').subscribe({
      next: () => {
        this.activeItemLoadingId = null;
        this.success = 'Sua marcação foi removida.';
        this.refreshView();
        this.loadItems();
      },
      error: (e: any) => {
        this.activeItemLoadingId = null;
        this.error = e?.error?.error ?? 'Erro ao atualizar item';
        this.refreshView();
      },
    });
  }

  claim(item: any) {
    this.clearMessages();

    this.activeItemLoadingId = item.id;
    this.refreshView();

    this.itemsApi.claim(item.id, true).subscribe({
      next: () => {
        this.activeItemLoadingId = null;
        this.success = 'Você assumiu este item.';
        this.refreshView();
        this.loadItems();
      },
      error: (e: any) => {
        this.activeItemLoadingId = null;
        this.error = e?.error?.error ?? 'Erro ao assumir item';
        this.refreshView();
      },
    });
  }

  unclaim(item: any) {
    this.clearMessages();

    this.activeItemLoadingId = item.id;
    this.refreshView();

    this.itemsApi.claim(item.id, false).subscribe({
      next: () => {
        this.activeItemLoadingId = null;
        this.success = 'Você liberou este item.';
        this.refreshView();
        this.loadItems();
      },
      error: (e: any) => {
        this.activeItemLoadingId = null;
        this.error = e?.error?.error ?? 'Erro ao liberar item';
        this.refreshView();
      },
    });
  }

  generateAiSuggestions() {
    this.aiError = null;
    this.aiAnswer = null;
    this.aiSections = [];
    this.aiSources = [];
    this.aiFocus = null;
    this.aiLoading = true;
    this.refreshView();

    const rawInterests = this.aiForm.get('interests')?.value || '';

    const interests = rawInterests
      .split(',')
      .map((item: string) => item.trim())
      .filter(Boolean);

    this.aiApi
      .getDestinationSuggestions(this.destinationId, {
        days: this.aiForm.get('days')?.value || '',
        budget: this.aiForm.get('budget')?.value || 'moderado',
        travelStyle: this.aiForm.get('travelStyle')?.value || 'equilibrado',
        interests,
      })
      .pipe(
        take(1),
        finalize(() => {
          this.aiLoading = false;
          this.refreshView();
        })
      )
      .subscribe({
        next: (r: any) => {
          console.log('[AI RESPONSE]', r);

          this.aiAnswer =
            r?.answer ||
            r?.summary ||
            'Sugestões geradas para esta viagem.';

          this.aiFocus = r?.focus || null;

          this.aiSections = Array.isArray(r?.sections)
            ? r.sections.map((section: any) => ({
                title: section?.title || 'Sugestão',
                description: section?.description || '',
                items: Array.isArray(section?.items)
                  ? section.items.map((item: any) => ({
                      name: item?.name || 'Sugestão',
                      details: item?.details || '',
                      tag: item?.tag || '',
                      searchQuery: item?.searchQuery || '',
                      placeType: item?.placeType || 'other',
                      googleSearchUrl: item?.googleSearchUrl || '',
                      place: item?.place || null,
                    }))
                  : [],
              }))
            : [];

          this.aiSources = Array.isArray(r?.sources)
            ? r.sources
            : [];

          this.refreshView();
        },
        error: (e: any) => {
          console.error('[AI ERROR]', e);

          if (e?.name === 'TimeoutError') {
            this.aiError = 'A IA demorou muito para responder. Tente novamente.';
            this.refreshView();
            return;
          }

          this.aiError =
            e?.error?.error ||
            e?.error?.detail ||
            'Erro ao gerar sugestões para a viagem.';

          this.refreshView();
        },
      });
  }
}
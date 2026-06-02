import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { DestinationsService } from '../../services/destinations.service';
import { CategoriesService, CategoryMode } from '../../services/categories.service';
import { ItemsService } from '../../services/items.service';

@Component({
  standalone: true,
  selector: 'app-destination-detail',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './destination-detail.html',
  styleUrl: './destination-detail.scss',
})
export class DestinationDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);

  private destinationsApi = inject(DestinationsService);
  private categoriesApi = inject(CategoriesService);
  private itemsApi = inject(ItemsService);

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
  inviteLoading = false;

  showInviteForm = false;
  showCategoryForm = false;
  showItemForm = false;

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

  ngOnInit() {
    this.destinationId = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadAll();
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

  clearMessages() {
    this.error = null;
    this.success = null;
  }

  loadAll(options: { keepMessages?: boolean } = {}) {
    if (!options.keepMessages) {
      this.clearMessages();
    }

    this.loadingDestination = true;

    this.destinationsApi.get(this.destinationId).subscribe({
      next: (r: any) => {
        this.destination = r.destination;
        this.members = r.members;
        this.loadingDestination = false;
      },
      error: (e: any) => {
        this.loadingDestination = false;
        this.error = e?.error?.error ?? 'Erro ao carregar viagem';
      },
    });

    this.loadCategories();
    this.loadItems();
  }

  loadCategories() {
    this.categoriesApi.list(this.destinationId).subscribe({
      next: (r: any[]) => (this.categories = r),
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao carregar categorias';
      },
    });
  }

  loadItems() {
    this.itemsApi.list(this.destinationId).subscribe({
      next: (r: any[]) => (this.items = r),
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao carregar itens';
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
      return;
    }

    this.showInviteForm = true;
  }

  closeInviteForm() {
    this.showInviteForm = false;
    this.inviteForm.reset({ email: '', role: 'MEMBER' });
  }

  openCategoryForm() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode criar categorias.';
      return;
    }

    this.showCategoryForm = true;
  }

  closeCategoryForm() {
    this.showCategoryForm = false;
    this.categoryForm.reset({ name: '', mode: 'PER_USER', sort_order: 0 });
  }

  openItemForm(categoryId?: string) {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode criar itens.';
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
  }

  closeItemForm() {
    this.showItemForm = false;
    this.itemForm.reset({ category_id: '', title: '', qty: 1, unit: '', notes: '' });
  }

  openItemFormForCategory(category: any) {
    this.openItemForm(category.id);
  }

  inviteMember() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode convidar pessoas.';
      return;
    }

    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }

    this.inviteLoading = true;

    this.destinationsApi.addMember(this.destinationId, this.inviteForm.getRawValue() as any).subscribe({
      next: () => {
        this.inviteLoading = false;
        this.success = 'Pessoa adicionada à viagem.';
        this.inviteForm.reset({ email: '', role: 'MEMBER' });
        this.showInviteForm = true;
        this.loadAll({ keepMessages: true });
      },
      error: (e: any) => {
        this.inviteLoading = false;
        this.error = e?.error?.error ?? 'Erro ao convidar pessoa';
      },
    });
  }

  changeMemberRole(member: any, role: 'ADMIN' | 'MEMBER') {
    this.clearMessages();

    if (member.role === role) return;

    this.destinationsApi.updateMemberRole(this.destinationId, member.user_id, role).subscribe({
      next: () => {
        this.success = 'Permissão atualizada.';
        this.loadAll({ keepMessages: true });
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao alterar permissão';
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
        this.loadAll({ keepMessages: true });
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao remover membro';
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
        this.loadAll({ keepMessages: true });
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao atualizar viagem';
      },
    });
  }

  createCategory() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode criar categorias.';
      return;
    }

    if (this.categoryForm.invalid) {
      this.categoryForm.markAllAsTouched();
      return;
    }

    this.categoryLoading = true;

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
        this.loadCategories();
      },
      error: (e: any) => {
        this.categoryLoading = false;
        this.error = e?.error?.error ?? 'Erro ao criar categoria';
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
      return;
    }

    const sortInput = window.prompt('Ordem da categoria', String(category.sort_order ?? 0));
    if (sortInput === null) return;

    const sort_order = Number(sortInput);

    this.categoriesApi.update(this.destinationId, category.id, { name, mode, sort_order }).subscribe({
      next: () => {
        this.success = 'Categoria atualizada.';
        this.loadCategories();
        this.loadItems();
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao atualizar categoria';
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
        this.loadCategories();
        this.loadItems();
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao excluir categoria';
      },
    });
  }

  createItem() {
    this.clearMessages();

    if (!this.isAdmin()) {
      this.error = 'Apenas o administrador pode criar itens.';
      return;
    }

    if (this.itemForm.invalid) {
      this.itemForm.markAllAsTouched();
      return;
    }

    this.itemLoading = true;
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
        this.loadItems();
      },
      error: (e: any) => {
        this.itemLoading = false;
        this.error = e?.error?.error ?? 'Erro ao criar item';
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
          this.loadItems();
        },
        error: (e: any) => {
          this.error = e?.error?.error ?? 'Erro ao atualizar item';
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
        this.loadItems();
      },
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao excluir item';
      },
    });
  }

  markDone(item: any) {
    this.clearMessages();

    this.itemsApi.setStatus(item.id, 'DONE').subscribe({
      next: () => this.loadItems(),
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao atualizar item';
      },
    });
  }

  markPending(item: any) {
    this.clearMessages();

    this.itemsApi.setStatus(item.id, 'PENDING').subscribe({
      next: () => this.loadItems(),
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao atualizar item';
      },
    });
  }

  claim(item: any) {
    this.clearMessages();

    this.itemsApi.claim(item.id, true).subscribe({
      next: () => this.loadItems(),
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao assumir item';
      },
    });
  }

  unclaim(item: any) {
    this.clearMessages();

    this.itemsApi.claim(item.id, false).subscribe({
      next: () => this.loadItems(),
      error: (e: any) => {
        this.error = e?.error?.error ?? 'Erro ao liberar item';
      },
    });
  }
}

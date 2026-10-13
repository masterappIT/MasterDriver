<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { api, apiFetch, errorText } from '../api';
import AppIcon from '../components/AppIcon.vue';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { imageForUpload } from '../image';
import { PAYMENT_KINDS, type PaymentKind, type PaymentMethod } from '../payment';
import { toast } from '../toast';

const MAX_METHODS = 5;

/**
 * 收款方式: how passengers can pay the dispatcher. Shown on the confirmation page of an order
 * only when the dispatcher turns it on for that order. The money goes straight to them.
 */
const methods = ref<PaymentMethod[]>([]);
const loaded = ref(false);
const error = ref('');
const busy = ref(false);
/** The method being edited (its id), 'new' for a new one, or null when only the list shows. */
const editing = ref<string | 'new' | null>(null);
const form = reactive({ kind: 'FPS' as PaymentKind, label: '', account: '', qrImage: '' as string | null, hadQr: false });
/** QR previews, read with the sign-in token so they show even if WeChat dropped the cookie. */
const previews = reactive<Record<string, string>>({});

async function preview(method: PaymentMethod) {
  if (!method.qrUrl || previews[method.qrUrl]) return;
  try {
    const response = await apiFetch('GET', method.qrUrl.replace(/^\/api/, ''));
    previews[method.qrUrl] = URL.createObjectURL(await response.blob());
  } catch {
    // The list still works without the picture.
  }
}

function show(list: PaymentMethod[]) {
  methods.value = list;
  list.forEach((method) => void preview(method));
}

async function run(action: () => Promise<PaymentMethod[]>, done: string) {
  error.value = '';
  busy.value = true;
  try {
    show(await action());
    editing.value = null;
    toast(done);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

function startNew() {
  Object.assign(form, { kind: 'FPS', label: PAYMENT_KINDS.FPS.name, account: '', qrImage: '', hadQr: false });
  editing.value = 'new';
}

function startEdit(method: PaymentMethod) {
  Object.assign(form, { kind: method.kind, label: method.label, account: method.account ?? '', qrImage: '', hadQr: Boolean(method.qrUrl) });
  editing.value = method.id;
}

/** Picking a kind fills in its usual name, unless a name was already typed. */
function pickKind(kind: PaymentKind) {
  const names = Object.values(PAYMENT_KINDS).map((item) => item.name);
  if (!form.label || names.includes(form.label)) form.label = PAYMENT_KINDS[kind].name;
  form.kind = kind;
}

async function pickQr(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    form.qrImage = await imageForUpload(file);
  } catch {
    error.value = t('無法讀取這張圖片');
  }
}

function save() {
  if (editing.value === 'new') {
    return run(
      () =>
        api<PaymentMethod[]>('POST', '/me/payment-methods', {
          kind: form.kind,
          label: form.label,
          account: form.account || undefined,
          qrImage: form.qrImage || undefined,
        }),
      '已加入',
    );
  }
  const id = editing.value;
  return run(
    () =>
      api<PaymentMethod[]>('PATCH', `/me/payment-methods/${id}`, {
        label: form.label,
        account: form.account || null,
        // Unchanged picture: leave it out. Removed picture: null. New picture: the image.
        ...(form.qrImage === '' ? {} : { qrImage: form.qrImage }),
      }),
    '已儲存',
  );
}

function removeQr() {
  form.qrImage = null;
  form.hadQr = false;
}

function remove(method: PaymentMethod) {
  if (!confirm(t(`刪除「${method.label}」？`))) return;
  return run(() => api<PaymentMethod[]>('DELETE', `/me/payment-methods/${method.id}`), '已刪除');
}

onMounted(async () => {
  try {
    show(await api<PaymentMethod[]>('GET', '/me/payment-methods'));
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
});
onBeforeUnmount(() => Object.values(previews).forEach((url) => URL.revokeObjectURL(url)));
</script>

<template>
  <div class="page">
    <PageBack :title="t('收款方式')" fallback="/app/me" />
    <p class="hint payment-methods__intro">
      {{ t('乘客付車費給你的方式。出單時打開「乘客確認頁顯示收款方式」，乘客就會在確認頁看到；錢直接付給你，平台不經手。') }}
    </p>
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="editing === null">
      <section v-for="method in methods" :key="method.id" class="card payment-methods__item">
        <img v-if="method.qrUrl && previews[method.qrUrl]" :src="previews[method.qrUrl]" :alt="t('收款碼')" class="payment-methods__qr" />
        <div class="payment-methods__text">
          <strong>{{ t(method.label) }}</strong>
          <span v-if="method.label !== PAYMENT_KINDS[method.kind].name" class="hint">{{ t(PAYMENT_KINDS[method.kind].name) }}</span>
          <span v-if="method.account" class="payment-methods__account">{{ method.account }}</span>
        </div>
        <div class="payment-methods__actions">
          <button class="chip" type="button" @click="startEdit(method)">{{ t('修改') }}</button>
          <button class="chip" type="button" :disabled="busy" @click="remove(method)">{{ t('刪除') }}</button>
        </div>
      </section>
      <p v-if="loaded && methods.length === 0" class="payment-methods__empty">{{ t('還沒有收款方式。') }}</p>
      <button v-if="loaded && methods.length < MAX_METHODS" class="button outline block" type="button" @click="startNew">
        <AppIcon name="add" :size="18" />{{ t('加收款方式') }}
      </button>
    </template>

    <form v-else class="card" @submit.prevent="save">
      <span class="section-label">{{ editing === 'new' ? t('加收款方式') : t('修改收款方式') }}</span>
      <div v-if="editing === 'new'" class="chips payment-methods__kinds">
        <button
          v-for="(kind, key) in PAYMENT_KINDS"
          :key="key"
          class="chip"
          :class="{ 'chip--on': form.kind === key }"
          type="button"
          :aria-pressed="form.kind === key"
          @click="pickKind(key)"
        >
          {{ t(kind.name) }}
        </button>
      </div>
      <p class="hint payment-methods__hint">{{ t(PAYMENT_KINDS[form.kind].hint) }}</p>

      <label class="line-field">
        <span>{{ t('名稱，乘客會看到') }}</span>
        <input v-model="form.label" class="line-input" maxlength="30" required />
      </label>
      <label v-if="PAYMENT_KINDS[form.kind].asks !== 'qr'" class="line-field">
        <span>{{ form.kind === 'OTHER' ? t('說明') : t('帳號或號碼') }}</span>
        <input v-model="form.account" class="line-input" maxlength="80" />
      </label>
      <div v-if="PAYMENT_KINDS[form.kind].asks !== 'account'" class="line-field">
        <span>{{ t('收款碼圖片（截圖即可）') }}</span>
        <div class="payment-methods__upload">
          <img v-if="form.qrImage" :src="form.qrImage" :alt="t('收款碼')" class="payment-methods__qr" />
          <span v-else-if="form.hadQr" class="hint">{{ t('已上傳，選新圖片會替換') }}</span>
          <label class="chip">
            {{ form.qrImage || form.hadQr ? t('換圖片') : t('選圖片') }}
            <input type="file" accept="image/*" hidden @change="pickQr" />
          </label>
          <button v-if="editing !== 'new' && (form.hadQr || form.qrImage)" class="chip" type="button" @click="removeQr">{{ t('移除圖片') }}</button>
        </div>
      </div>

      <div class="payment-methods__pair">
        <button class="button secondary" type="button" @click="editing = null">{{ t('取消') }}</button>
        <button class="button" type="submit" :disabled="busy">{{ t('儲存') }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.payment-methods__intro {
  margin: 0 var(--space-xs) var(--space-lg);
}
.payment-methods__item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}
.payment-methods__qr {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  object-fit: contain;
  border-radius: var(--radius-input);
  background: var(--color-surface);
}
.payment-methods__text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.payment-methods__account {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.payment-methods__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.payment-methods__empty {
  color: var(--color-text-secondary);
  text-align: center;
}
.payment-methods__kinds {
  margin-bottom: var(--space-sm);
}
.payment-methods__hint {
  margin: 0 0 var(--space-lg);
}
.payment-methods__upload {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}
.payment-methods__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}
</style>

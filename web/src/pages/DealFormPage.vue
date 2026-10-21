<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import type { DriverDeal } from '../deal';
import PageBack from '../components/PageBack.vue';
import { fromLocalInput, toLocalInput } from '../format';
import { t } from '../i18n';

/**
 * 發特價車, or 修改 one still taking bookings: when, where and the whole car's price, then the
 * driver sends the link themselves. Nothing here lists the deal anywhere: only the link brings people.
 */
const route = useRoute();
const router = useRouter();
/** Set when changing a deal; bookings already sent keep their own time and price. */
const editId = typeof route.params.id === 'string' ? route.params.id : '';
const error = ref('');
const busy = ref(false);
const loaded = ref(!editId);

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
tomorrow.setMinutes(0, 0, 0);
const form = reactive({
  /** 時段: the passenger picks a time within it. */
  window: false,
  pickupAt: toLocalInput(tomorrow),
  pickupUntil: '',
  origin: '',
  destination: '',
  /** In 人民幣 by default, as an order's prices are. */
  currency: 'CNY',
  price: '',
  originalPrice: '',
  maxPassengers: '',
  maxLuggage: '',
  notes: '',
  autoAccept: false,
});

const prefix = computed(() => ({ CNY: 'RMB¥', HKD: 'HK$', MOP: 'MOP$' })[form.currency] ?? '');
/** The 時段's end, four hours after its start until the driver changes it. */
function openWindow() {
  form.window = true;
  if (!form.pickupUntil) {
    const start = new Date(fromLocalInput(form.pickupAt)).getTime();
    if (!Number.isNaN(start)) form.pickupUntil = toLocalInput(new Date(start + 4 * 60 * 60 * 1000));
  }
}

async function submit() {
  error.value = '';
  const number = (value: string) => (value === '' ? null : Number(value));
  const body = {
    pickupAt: fromLocalInput(form.pickupAt),
    pickupUntil: form.window && form.pickupUntil ? fromLocalInput(form.pickupUntil) : null,
    origin: form.origin,
    destination: form.destination,
    price: Number(form.price),
    currency: form.currency,
    originalPrice: number(form.originalPrice),
    maxPassengers: number(form.maxPassengers),
    maxLuggage: number(form.maxLuggage),
    notes: form.notes.trim() || null,
    autoAccept: form.autoAccept,
  };
  if (body.originalPrice !== null && body.originalPrice <= body.price) {
    error.value = t('原價要比特價高；不想顯示原價就留空。');
    return;
  }
  busy.value = true;
  try {
    if (editId) {
      await api<DriverDeal>('PATCH', `/deals/${editId}`, body);
      await router.replace(`/app/deals/${editId}`);
    } else {
      // A new deal leaves out what was not filled in rather than clearing it.
      const created = await api<DriverDeal>(
        'POST',
        '/deals',
        Object.fromEntries(Object.entries(body).filter(([, value]) => value !== null)),
      );
      await router.replace(`/app/deals/${created.id}?new=1`);
    }
  } catch (e) {
    error.value = errorText(e);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  if (!editId) return;
  try {
    const deal = await api<DriverDeal>('GET', `/deals/${editId}`);
    Object.assign(form, {
      window: Boolean(deal.pickupUntil),
      pickupAt: toLocalInput(new Date(deal.pickupAt)),
      pickupUntil: deal.pickupUntil ? toLocalInput(new Date(deal.pickupUntil)) : '',
      origin: deal.origin,
      destination: deal.destination,
      currency: deal.price.currency,
      price: String(deal.price.amount),
      originalPrice: deal.originalPrice ? String(deal.originalPrice.amount) : '',
      maxPassengers: deal.maxPassengers === null ? '' : String(deal.maxPassengers),
      maxLuggage: deal.maxLuggage === null ? '' : String(deal.maxLuggage),
      notes: deal.notes ?? '',
      autoAccept: deal.autoAccept,
    });
    loaded.value = true;
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page">
    <PageBack :title="editId ? t('修改特價車') : t('發特價車')" :fallback="editId ? `/app/deals/${editId}` : '/app/deals'" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <div v-if="!session.profile" class="notice">
      {{ t('發特價車前，請先填好司機資料，乘客會看到你的車型。') }}
      <RouterLink to="/app/profile">{{ t('填寫司機資料') }}</RouterLink>
    </div>

    <form v-else-if="loaded" @submit.prevent="submit">
      <p v-if="!editId" class="hint deal-form__intro">
        {{ t('空車回程、冷門時段，用一個特價把車賣出去。發好後會得到一條連結和一張分享圖，你自己發給乘客；平台不會把特價車列給其他人看。') }}
      </p>
      <p v-else class="hint deal-form__intro">{{ t('已經送出的預約照原本的時間和價錢；改了之後新的預約才用新的。') }}</p>

      <section class="card">
        <span class="section-label">{{ t('行程') }}</span>
        <div class="segment segment--block deal-form__gap" role="group" :aria-label="t('出發時間')">
          <button type="button" :aria-pressed="!form.window" @click="form.window = false">{{ t('準確時間') }}</button>
          <button type="button" :aria-pressed="form.window" @click="openWindow">{{ t('一個時段') }}</button>
        </div>
        <label class="line-field">
          <span>{{ form.window ? t('時段開始（香港時間）') : t('出發時間（香港時間）') }}</span>
          <input v-model="form.pickupAt" class="line-input" type="datetime-local" required />
        </label>
        <label v-if="form.window" class="line-field">
          <span>{{ t('時段結束') }}</span>
          <input v-model="form.pickupUntil" class="line-input" type="datetime-local" required />
          <small class="hint">{{ t('乘客在這段時間內自己選出發時間，最長 24 小時。') }}</small>
        </label>
        <ol class="route-inputs">
          <li class="route-inputs__stop route-inputs__stop--origin">
            <input v-model="form.origin" class="line-input" maxlength="120" :aria-label="t('出發地')" :placeholder="t('從哪裡出發，例如：深圳灣口岸')" required />
          </li>
          <li class="route-inputs__stop route-inputs__stop--destination">
            <input v-model="form.destination" class="line-input" maxlength="120" :aria-label="t('目的地')" :placeholder="t('去哪裡，例如：香港國際機場')" required />
          </li>
        </ol>
      </section>

      <section class="card">
        <span class="section-label">{{ t('價錢') }}</span>
        <div class="line-field">
          <span>{{ t('整車特價') }}</span>
          <div class="amount-line">
            <select v-model="form.currency" :aria-label="t('幣種')">
              <option value="CNY">RMB¥</option>
              <option value="HKD">HK$</option>
              <option value="MOP">MOP$</option>
            </select>
            <input v-model="form.price" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('整車特價')" :placeholder="t('整車一個價')" required />
          </div>
        </div>
        <label class="line-field">
          <span>{{ t('原價（選填）') }}</span>
          <input v-model="form.originalPrice" class="line-input" type="number" min="0" step="0.01" inputmode="decimal" :placeholder="t(`例如平時收 ${prefix}500`)" />
          <small class="hint">{{ t('填了會劃線顯示在特價旁邊，讓乘客看到便宜了多少。') }}</small>
        </label>
        <div class="deal-form__pair">
          <label class="line-field">
            <span>{{ t('最多幾人（選填）') }}</span>
            <input v-model="form.maxPassengers" class="line-input" type="number" min="1" max="59" inputmode="numeric" />
          </label>
          <label class="line-field">
            <span>{{ t('最多幾件行李（選填）') }}</span>
            <input v-model="form.maxLuggage" class="line-input" type="number" min="0" max="60" inputmode="numeric" />
          </label>
        </div>
        <label class="line-field">
          <span>{{ t('備註（選填）') }}</span>
          <textarea v-model="form.notes" class="line-input" maxlength="500" :placeholder="t('例如：不用下車過關、可放嬰兒車')" />
        </label>
      </section>

      <section class="card">
        <span class="section-label">{{ t('乘客預約後') }}</span>
        <div class="segment segment--block" role="group" :aria-label="t('確認方式')">
          <button type="button" :aria-pressed="!form.autoAccept" @click="form.autoAccept = false">{{ t('我確認') }}</button>
          <button type="button" :aria-pressed="form.autoAccept" @click="form.autoAccept = true">{{ t('自動接受第一組') }}</button>
        </div>
        <small class="hint deal-form__explain">
          {{
            form.autoAccept
              ? t('第一組送出就訂到，其他人不能再預約。不用登入就能預約，任何拿到連結的人都可以訂。')
              : t('可以有幾組預約，你挑一組成單；成單後其他預約自動婉拒。')
          }}
        </small>
      </section>

      <button class="button block large" type="submit" :disabled="busy">{{ editId ? t('儲存') : t('發特價車，取得連結') }}</button>
    </form>
  </div>
</template>

<style scoped>
.line-field > small {
  display: block;
  margin-top: var(--space-xs);
}
.deal-form__intro {
  margin: 0 0 var(--space-md);
}
.deal-form__gap {
  margin-bottom: var(--space-md);
}
.deal-form__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
.deal-form__explain {
  display: block;
  margin-top: var(--space-sm);
}
</style>

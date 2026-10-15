<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import PageBack from '../components/PageBack.vue';
import { fromLocalInput, toLocalInput } from '../format';
import { t } from '../i18n';

/**
 * 開拼車: the driver sets out the trip, the seats and the price a seat, then gives the link to
 * passengers themselves. Nothing here lists the carpool anywhere: only the link brings people.
 */
const router = useRouter();
const error = ref('');
const busy = ref(false);
const paymentMethodCount = ref<number | null>(null);

/** The car's seats less the driver's own; null until the driver details say how many. */
const maxSeats = computed(() => (session.profile?.seats && session.profile.seats > 1 ? session.profile.seats - 1 : null));

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
tomorrow.setMinutes(0, 0, 0);
const form = reactive({
  pickupAt: toLocalInput(tomorrow),
  origin: '',
  destination: '',
  pickupPoints: [] as string[],
  seats: '',
  minPassengers: '',
  currency: 'HKD',
  seatPrice: '',
  luggagePerSeat: '',
  /** Blank: two hours before pickup. */
  closesAt: '',
  autoConfirm: false,
  waitMinutes: '15',
  showPaymentMethods: false,
  cancelPolicy: '',
  notes: '',
});

const defaultClose = computed(() => {
  const pickup = new Date(fromLocalInput(form.pickupAt)).getTime();
  return Number.isNaN(pickup) ? '' : toLocalInput(new Date(pickup - 2 * 60 * 60 * 1000)).replace('T', ' ');
});

function addPoint() {
  if (form.pickupPoints.length < 6) form.pickupPoints.push('');
}

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const number = (value: string) => (value === '' ? undefined : Number(value));
    const created = await api<{ id: string }>('POST', '/carpools', {
      pickupAt: fromLocalInput(form.pickupAt),
      origin: form.origin,
      destination: form.destination,
      pickupPoints: form.pickupPoints.map((point) => point.trim()).filter(Boolean),
      seats: Number(form.seats),
      minPassengers: number(form.minPassengers),
      seatPrice: form.seatPrice === '' ? undefined : { amount: Number(form.seatPrice), currency: form.currency },
      luggagePerSeat: number(form.luggagePerSeat),
      closesAt: form.closesAt ? fromLocalInput(form.closesAt) : undefined,
      autoConfirm: form.autoConfirm,
      waitMinutes: Number(form.waitMinutes || 0),
      showPaymentMethods: form.showPaymentMethods,
      cancelPolicy: form.cancelPolicy,
      notes: form.notes,
    });
    await router.replace(`/app/carpools/${created.id}?new=1`);
  } catch (e) {
    error.value = errorText(e);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (maxSeats.value) form.seats = String(maxSeats.value);
  void api<unknown[]>('GET', '/me/payment-methods')
    .then((methods) => (paymentMethodCount.value = methods.length))
    .catch(() => (paymentMethodCount.value = null));
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('開拼車')" fallback="/app/carpools" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <div v-if="!session.profile || !maxSeats" class="notice">
      {{ t('開拼車前，請先在司機資料填好車型和座位數。座位數決定可以讓乘客報幾個位。') }}
      <RouterLink to="/app/profile">{{ t('填寫司機資料') }}</RouterLink>
    </div>

    <form v-else @submit.prevent="submit">
      <p class="hint carpool-new__intro">
        {{ t('開好後會得到一條連結，你自己發給乘客（乘客群、朋友圈或私聊）。平台不會把拼車列給其他人看。') }}
      </p>

      <section class="card">
        <span class="section-label">{{ t('行程') }}</span>
        <label class="line-field">
          <span>{{ t('出發時間（香港時間）') }}</span>
          <input v-model="form.pickupAt" class="line-input" type="datetime-local" required />
        </label>
        <ol class="route-inputs">
          <li class="route-inputs__stop route-inputs__stop--origin">
            <input v-model="form.origin" class="line-input" maxlength="120" :aria-label="t('出發地')" :placeholder="t('從哪裡出發，例如：深圳灣口岸')" required />
          </li>
          <li class="route-inputs__stop route-inputs__stop--destination">
            <input v-model="form.destination" class="line-input" maxlength="120" :aria-label="t('目的地')" :placeholder="t('去哪裡，例如：香港國際機場')" required />
          </li>
        </ol>
        <div class="line-field">
          <span>{{ t('上車點（選填）') }}</span>
          <small class="hint">{{ t('列出幾個讓乘客選；不填就由乘客自己寫上車地點。') }}</small>
          <div v-for="(_, index) in form.pickupPoints" :key="index" class="carpool-new__point">
            <input v-model="form.pickupPoints[index]" class="line-input" maxlength="120" :aria-label="t(`上車點 ${index + 1}`)" :placeholder="t('例如：南山海岸城')" />
            <button class="chip" type="button" @click="form.pickupPoints.splice(index, 1)">{{ t('刪除') }}</button>
          </div>
          <button v-if="form.pickupPoints.length < 6" class="chip carpool-new__add" type="button" @click="addPoint">{{ t('加上車點') }}</button>
        </div>
      </section>

      <section class="card">
        <span class="section-label">{{ t('座位與價錢') }}</span>
        <div class="carpool-new__pair">
          <label class="line-field">
            <span>{{ t('給乘客的座位') }}</span>
            <input v-model="form.seats" class="line-input" type="number" min="1" :max="maxSeats ?? 59" inputmode="numeric" required />
          </label>
          <label class="line-field">
            <span>{{ t('最少成行人數（選填）') }}</span>
            <input v-model="form.minPassengers" class="line-input" type="number" min="1" :max="form.seats || maxSeats || 59" inputmode="numeric" />
          </label>
        </div>
        <p class="hint carpool-new__note">{{ t(`你的車 ${session.profile.seats} 座，最多 ${maxSeats} 位乘客。`) }}</p>
        <div class="line-field">
          <span>{{ t('每位價錢（選填）') }}</span>
          <div class="amount-line">
            <select v-model="form.currency" :aria-label="t('幣種')">
              <option value="CNY">RMB¥</option>
              <option value="HKD">HK$</option>
              <option value="MOP">MOP$</option>
            </select>
            <input v-model="form.seatPrice" type="number" min="0" step="0.01" inputmode="decimal" :aria-label="t('每位價錢')" :placeholder="t('不填就寫「每位價錢請私訊」')" />
          </div>
        </div>
        <label class="line-field">
          <span>{{ t('每位行李件數（選填）') }}</span>
          <input v-model="form.luggagePerSeat" class="line-input" type="number" min="0" max="10" inputmode="numeric" />
        </label>
      </section>

      <section class="card">
        <span class="section-label">{{ t('報位') }}</span>
        <label class="line-field">
          <span>{{ t('報位截止（選填）') }}</span>
          <input v-model="form.closesAt" class="line-input" type="datetime-local" />
          <small class="hint">{{ defaultClose ? t(`不填就是出發前 2 小時（${defaultClose}）`) : '' }}</small>
        </label>
        <div class="line-field">
          <span>{{ t('乘客報位後') }}</span>
          <div class="segment segment--block" role="group" :aria-label="t('確認方式')">
            <button type="button" :aria-pressed="!form.autoConfirm" @click="form.autoConfirm = false">{{ t('我逐個確認') }}</button>
            <button type="button" :aria-pressed="form.autoConfirm" @click="form.autoConfirm = true">{{ t('自動確認') }}</button>
          </div>
          <small class="hint">
            {{
              form.autoConfirm
                ? t('乘客報位就算成功。不用登入就能報位，任何拿到連結的人都可以報。')
                : t('你確認了才算報位成功；2 小時內沒回覆，報位會失效，座位放回去。')
            }}
          </small>
        </div>
        <label class="line-field">
          <span>{{ t('到上車點後等多久才可以按「乘客沒出現」（分鐘）') }}</span>
          <input v-model="form.waitMinutes" class="line-input" type="number" min="0" max="120" inputmode="numeric" />
        </label>
        <label v-if="paymentMethodCount" class="carpool-new__switch">
          <span>
            {{ t('乘客連結顯示收款方式') }}
            <small>{{ t('乘客確認後看到你的收款方式，按每位價錢乘人數付給你') }}</small>
          </span>
          <input v-model="form.showPaymentMethods" class="switch" type="checkbox" />
        </label>
        <p v-else-if="paymentMethodCount === 0" class="hint">
          <RouterLink to="/app/payment-methods">{{ t('設定收款方式') }}</RouterLink>{{ t('，乘客可以直接付給你') }}
        </p>
        <label class="line-field">
          <span>{{ t('取消規則（選填）') }}</span>
          <textarea v-model="form.cancelPolicy" class="line-input" maxlength="300" :placeholder="t('例如：出發前 24 小時內取消，收一半')" />
          <small class="hint">{{ t('乘客報位前看得到。平台不經手車費，規則由你和乘客自己處理。') }}</small>
        </label>
        <label class="line-field">
          <span>{{ t('備註（選填）') }}</span>
          <textarea v-model="form.notes" class="line-input" maxlength="500" :placeholder="t('例如：不用下車過關、可放嬰兒車')" />
        </label>
      </section>

      <button class="button block large" type="submit" :disabled="busy">{{ t('開拼車，取得連結') }}</button>
    </form>
  </div>
</template>

<style scoped>
.line-field > small {
  display: block;
  margin-top: var(--space-xs);
}
.carpool-new__intro {
  margin: 0 0 var(--space-md);
}
.carpool-new__point {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}
.carpool-new__point .line-input {
  flex: 1;
  min-width: 0;
}
.carpool-new__add {
  align-self: flex-start;
  margin-top: var(--space-sm);
}
.carpool-new__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
.carpool-new__note {
  margin: 0 0 var(--space-md);
}
.carpool-new__switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 48px;
  padding: var(--space-sm) 0;
  font-weight: 600;
}
.carpool-new__switch > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.carpool-new__switch small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
</style>

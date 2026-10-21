<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { formatPassengerPhone, isValidPassengerPhone, type CountryCode } from '@masterdriver/shared/phone';
import { api, errorText } from '../api';
import { DEAL_STATE, dealLimits, dealTime, type PublicDeal } from '../deal';
import CarpoolCarCard from '../components/CarpoolCar.vue';
import PhoneField from '../components/PhoneField.vue';
import { fromLocalInput, money, toLocalInput } from '../format';
import { t } from '../i18n';

/**
 * The link a driver gives passengers for a 特價車: when, where, the whole car's price, the driver
 * and their car, and a short form to book it. No account; the passenger gets a link of their own.
 */
const route = useRoute();
const router = useRouter();
const code = String(route.params.code);
const source = typeof route.query.from === 'string' ? route.query.from : undefined;
const deal = ref<PublicDeal | null>(null);
const error = ref('');
const formError = ref('');
const busy = ref(false);
const form = reactive({
  pickupAt: '',
  passengers: '1',
  luggage: '0',
  origin: '',
  destination: '',
  passengerName: '',
  passengerCountry: '+852' as CountryCode,
  passengerPhone: '',
  passengerWechat: '',
  notes: '',
});

const open = computed(() => deal.value?.state === 'OPEN');
const closedText = computed(() => {
  const state = deal.value?.state;
  if (state === 'SOLD') return '這個特價車已被訂走。';
  if (state === 'CANCELLED') return '這個特價車已下架。';
  return '這個特價車已過了出發時間。';
});
/** 時段: the passenger picks within it, never before now. */
const earliest = computed(() => {
  const d = deal.value;
  if (!d) return '';
  const start = Math.max(new Date(d.pickupAt).getTime(), Date.now());
  return toLocalInput(new Date(start));
});

async function submit() {
  formError.value = '';
  if (!isValidPassengerPhone(form.passengerCountry, form.passengerPhone)) {
    formError.value = t(form.passengerCountry === '+86' ? '電話請填 11 位內地手機號碼' : '電話請填 8 位數字');
    document.getElementById('deal-phone')?.focus();
    return;
  }
  busy.value = true;
  try {
    const sent = await api<{ code: string }>('POST', `/public/deals/${code}/bookings`, {
      // Without a 時段 the deal's own time is the one; the server keeps to it either way.
      pickupAt: deal.value?.pickupUntil ? fromLocalInput(form.pickupAt) : deal.value?.pickupAt,
      passengers: Number(form.passengers),
      luggage: Number(form.luggage),
      origin: form.origin,
      destination: form.destination,
      passengerName: form.passengerName,
      passengerContact: formatPassengerPhone(form.passengerCountry, form.passengerPhone),
      passengerWechat: form.passengerWechat,
      notes: form.notes,
      source,
    });
    await router.push(`/b/${sent.code}?sent=1`);
  } catch (e) {
    formError.value = errorText(e);
    // Someone else may have got it while the passenger filled in the form.
    void load();
  } finally {
    busy.value = false;
  }
}

async function load() {
  try {
    deal.value = await api<PublicDeal>('GET', `/public/deals/${code}`);
    if (deal.value.pickupUntil && !form.pickupAt) form.pickupAt = earliest.value;
    document.title = `${t('特價車')} ${deal.value.origin} → ${deal.value.destination}｜MasterDriver ${t('跨境師傅幫')}`;
  } catch (e) {
    error.value = errorText(e);
  }
}

onMounted(load);
</script>

<template>
  <div class="page deal-public">
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="deal">
      <h1 class="deal-public__title">{{ t('特價車') }}</h1>
      <section class="card deal-public__trip">
        <span v-if="!open" class="deal-public__state">{{ t(DEAL_STATE[deal.state].passenger) }}</span>
        <strong class="deal-public__time">{{ t(dealTime(deal)) }}</strong>
        <div class="deal-public__route">{{ t(`${deal.origin} 至 ${deal.destination}`) }}</div>
        <div class="deal-public__price">
          <strong>{{ t(`整車 ${money(deal.price)}`) }}</strong>
          <s v-if="deal.originalPrice">{{ t(`原價 ${money(deal.originalPrice)}`) }}</s>
        </div>
        <p v-if="dealLimits(deal)" class="deal-public__line">{{ t(dealLimits(deal)) }}</p>
        <p v-if="deal.pickupUntil" class="deal-public__line">{{ t('在這個時段內，你自己選出發時間') }}</p>
        <p v-if="deal.notes" class="deal-public__note">{{ t(deal.notes) }}</p>
      </section>

      <section class="card">
        <span class="section-label">{{ t('司機') }}</span>
        <CarpoolCarCard :car="deal.driver" />
      </section>

      <div v-if="!open" class="notice">
        {{ t(closedText) }}
        <RouterLink v-if="deal.driver.pageCode" :to="`/p/${deal.driver.pageCode}`">{{ t('打開司機的名片頁，問問有沒有其他車') }}</RouterLink>
      </div>

      <form v-else class="card deal-public__form" @submit.prevent="submit">
        <span class="section-label">{{ t('預約') }}</span>
        <p class="hint">
          {{ deal.autoAccept ? t('一部車只接一組。第一個送出的就訂到，不用註冊，也不用先付款。') : t('一部車只接一組。送出後等司機確認，不用註冊，也不用先付款。') }}
        </p>
        <div v-if="formError" class="notice error">{{ formError }}</div>
        <label v-if="deal.pickupUntil" class="line-field">
          <span>{{ t('出發時間（香港時間）') }}</span>
          <input
            v-model="form.pickupAt"
            class="line-input"
            type="datetime-local"
            :min="earliest"
            :max="toLocalInput(new Date(deal.pickupUntil))"
            required
          />
        </label>
        <div class="deal-public__pair">
          <label class="line-field">
            <span>{{ t('人數') }}</span>
            <input v-model="form.passengers" class="line-input" type="number" min="1" :max="deal.maxPassengers ?? 59" inputmode="numeric" required />
          </label>
          <label class="line-field">
            <span>{{ t('行李') }}</span>
            <input v-model="form.luggage" class="line-input" type="number" min="0" :max="deal.maxLuggage ?? 60" inputmode="numeric" />
          </label>
        </div>
        <label class="line-field">
          <span>{{ t('在哪裡上車（選填）') }}</span>
          <input v-model="form.origin" class="line-input" maxlength="120" :placeholder="t(`不填就是 ${deal.origin}`)" />
        </label>
        <label class="line-field">
          <span>{{ t('在哪裡下車（選填）') }}</span>
          <input v-model="form.destination" class="line-input" maxlength="120" :placeholder="t(`不填就是 ${deal.destination}`)" />
        </label>
        <input v-model.trim="form.passengerName" class="line-input deal-public__gap" maxlength="40" :aria-label="t('稱呼')" :placeholder="t('怎樣稱呼你，例如：王小姐')" required />
        <div class="line-field">
          <label for="deal-phone">{{ t('你的電話，只有這位司機看得到') }}</label>
          <PhoneField id="deal-phone" v-model:country="form.passengerCountry" v-model:phone="form.passengerPhone" />
        </div>
        <label class="line-field">
          <span>{{ t('微信號（選填）') }}</span>
          <input v-model="form.passengerWechat" class="line-input" maxlength="60" />
        </label>
        <label class="line-field">
          <span>{{ t('備註（選填）') }}</span>
          <textarea v-model="form.notes" class="line-input" maxlength="500" :placeholder="t('例如：航班號碼、帶嬰兒車')" />
        </label>
        <button class="button block large" type="submit" :disabled="busy">{{ t(`預約，整車 ${money(deal.price)}`) }}</button>
      </form>

      <footer class="deal-public__footer hint">
        <p>{{ t('這個特價由司機自己定。師傅幫不審核司機，也不擔保服務；車費由你和司機自行約定並直接支付，平台不收款。') }}</p>
        <p><RouterLink to="/support">{{ t('檢舉這個特價車') }}</RouterLink></p>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.deal-public__title {
  margin: var(--space-sm) 0 var(--space-md);
}
.deal-public__trip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
}
.deal-public__state {
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  background: var(--color-divider);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 700;
}
.deal-public__time {
  font-size: var(--font-body-large);
  font-variant-numeric: tabular-nums;
}
.deal-public__route {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.deal-public__price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 var(--space-md);
  margin-top: var(--space-xs);
}
.deal-public__price strong {
  color: var(--color-gold-ink);
  font-size: 24px;
}
.deal-public__price s {
  color: var(--color-text-secondary);
}
.deal-public__line {
  margin: 0;
  color: var(--color-text-secondary);
}
.deal-public__note {
  align-self: stretch;
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  white-space: pre-wrap;
}
.deal-public__pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
.deal-public__gap {
  margin-bottom: var(--space-lg);
}
.deal-public__footer {
  margin-top: var(--space-xl);
  line-height: 1.6;
}
</style>

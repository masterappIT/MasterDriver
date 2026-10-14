<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText } from '../api';
import PageBack from '../components/PageBack.vue';
import { copyText } from '../device';
import { shortTime } from '../format';
import { t } from '../i18n';
import { pickedPassenger, type BookPassenger } from '../passenger-pick';
import { toast } from '../toast';

/**
 * 客人通訊錄: the passengers of the orders this driver put out, read from those orders. Only
 * their own: a driver who took an order does not get its passenger here.
 */
const router = useRouter();
const passengers = ref<BookPassenger[]>([]);
const loaded = ref(false);
const error = ref('');
const query = ref('');

const shown = computed(() => {
  const word = query.value.trim().toLowerCase();
  if (!word) return passengers.value;
  return passengers.value.filter((item) => `${item.name ?? ''} ${item.contact}`.toLowerCase().includes(word));
});

async function copy(contact: string) {
  toast((await copyText(contact)) ? '已複製號碼' : '複製失敗，請長按號碼自行複製');
}

function newOrderFor(passenger: BookPassenger) {
  pickedPassenger.value = passenger;
  void router.push('/app/new');
}

onMounted(async () => {
  try {
    passengers.value = await api<BookPassenger[]>('GET', '/orders/passengers');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('客人通訊錄')" fallback="/app/me" />
    <div v-if="error" class="notice error">{{ error }}</div>
    <p class="hint passengers__about">{{ t('你出過的單的乘客會自動出現在這裡，只有你看得到。接你的單的司機不會得到這份名單。') }}</p>

    <input v-if="passengers.length > 5" v-model="query" class="line-input passengers__search" :aria-label="t('找客人')" :placeholder="t('輸入稱呼或電話')" />

    <section v-for="passenger in shown" :key="passenger.contact" class="card passengers__card">
      <div class="passengers__head">
        <strong>{{ passenger.name ? t(passenger.name) : t('沒有稱呼') }}</strong>
        <span class="hint">{{ t(passenger.trips > 0 ? `搭過 ${passenger.trips} 次` : '還沒成行') }}</span>
      </div>
      <div class="passengers__phone">{{ passenger.contact }}</div>
      <p class="hint passengers__last">{{ t(`最近：${shortTime(passenger.lastPickupAt)} ${passenger.lastRoute}`) }}</p>
      <div class="passengers__actions">
        <a class="chip" :href="`tel:${passenger.contact.replace(/\s/g, '')}`">{{ t('致電') }}</a>
        <button class="chip" type="button" @click="copy(passenger.contact)">{{ t('複製號碼') }}</button>
        <button class="chip chip--on" type="button" @click="newOrderFor(passenger)">{{ t('出單') }}</button>
      </div>
    </section>

    <p v-if="loaded && !error && passengers.length === 0" class="card muted">{{ t('還沒有客人。出了第一張單之後，乘客會出現在這裡。') }}</p>
    <p v-else-if="loaded && shown.length === 0" class="muted">{{ t('找不到符合的客人。') }}</p>
  </div>
</template>

<style scoped>
.passengers__about {
  margin: 0 var(--space-xs) var(--space-md);
}
.passengers__search {
  margin-bottom: var(--space-md);
}
.passengers__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
}
.passengers__phone {
  margin-top: var(--space-xs);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.passengers__last {
  margin: var(--space-xs) 0 var(--space-md);
}
.passengers__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
</style>

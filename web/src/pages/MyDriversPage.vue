<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, errorText } from '../api';
import PageBack from '../components/PageBack.vue';
import { shortTime } from '../format';
import { t } from '../i18n';
import { toast } from '../toast';

interface MyDriver {
  id: string;
  name: string | null;
  phone: string;
  vehicleType: string | null;
  plates: string[];
  /** Orders of yours they took and did not give back. */
  taken: number;
  completed: number;
  /** Times they took one of your orders and gave it back (取消接單). */
  released: number;
  lastAt: string | null;
  /** 常用司機: offered your orders first when you choose 先給常用司機. */
  favorite: boolean;
  /** Your own note; nobody else sees it. */
  note: string | null;
}

/**
 * 我的司機: the drivers who took this dispatcher's orders, read from those orders, with the
 * dispatcher's own mark (常用司機) and note. Only theirs to see: no rating anyone else reads.
 */
const drivers = ref<MyDriver[]>([]);
const loaded = ref(false);
const error = ref('');
const busy = ref(false);
/** The driver whose note is being written, and what it says so far. */
const editing = ref<string | null>(null);
const draft = ref('');

async function save(driver: MyDriver, body: { favorite?: boolean; note?: string | null }, done: string) {
  busy.value = true;
  try {
    const updated = await api<MyDriver>('PUT', `/me/drivers/${driver.id}`, body);
    drivers.value = drivers.value.map((one) => (one.id === driver.id ? updated : one));
    editing.value = null;
    toast(done);
  } catch (e) {
    toast(errorText(e));
  } finally {
    busy.value = false;
  }
}

function editNote(driver: MyDriver) {
  editing.value = driver.id;
  draft.value = driver.note ?? '';
}

onMounted(async () => {
  try {
    drivers.value = await api<MyDriver[]>('GET', '/me/drivers');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
});
</script>

<template>
  <div class="page">
    <PageBack :title="t('我的司機')" fallback="/app/me" />
    <div v-if="error" class="notice error">{{ error }}</div>
    <p class="hint my-drivers__about">
      {{ t('接過你的單的司機會自動出現在這裡。設為常用司機後，出單時可以選「先給常用司機 30 分鐘」。紀錄和備註只有你看得到。') }}
    </p>

    <section v-for="driver in drivers" :key="driver.id" class="card my-drivers__card">
      <div class="my-drivers__head">
        <strong>{{ driver.name ? t(driver.name) : t('沒有留名') }}</strong>
        <span v-if="driver.favorite" class="leg-tag">{{ t('常用司機') }}</span>
      </div>
      <p class="hint my-drivers__car">{{ [driver.vehicleType, ...driver.plates].filter(Boolean).join(' · ') }}</p>
      <p class="my-drivers__record">
        {{ t(`接過你 ${driver.taken} 張單，完成 ${driver.completed} 張`) }}<template v-if="driver.released">{{ t(`，取消接單 ${driver.released} 次`) }}</template>
      </p>
      <p v-if="driver.lastAt" class="hint my-drivers__last">{{ t(`最近一次：${shortTime(driver.lastAt)}`) }}</p>

      <form v-if="editing === driver.id" class="my-drivers__note-form" @submit.prevent="save(driver, { note: draft.trim() || null }, '已儲存備註')">
        <textarea v-model="draft" class="line-input" maxlength="200" :aria-label="t('備註')" :placeholder="t('只有你看得到，例如：準時、熟深圳灣')" />
        <div class="my-drivers__actions">
          <button class="chip" type="button" @click="editing = null">{{ t('取消') }}</button>
          <button class="chip chip--on" type="submit" :disabled="busy">{{ t('儲存') }}</button>
        </div>
      </form>
      <p v-else-if="driver.note" class="my-drivers__note">{{ t(driver.note) }}</p>

      <div v-if="editing !== driver.id" class="my-drivers__actions">
        <a class="chip" :href="`tel:${driver.phone.replace(/\s/g, '')}`">{{ t('致電') }}</a>
        <button class="chip" type="button" @click="editNote(driver)">{{ driver.note ? t('改備註') : t('寫備註') }}</button>
        <button
          class="chip"
          :class="{ 'chip--on': !driver.favorite }"
          type="button"
          :disabled="busy"
          @click="save(driver, { favorite: !driver.favorite }, driver.favorite ? '已取消常用司機' : '已設為常用司機')"
        >
          {{ driver.favorite ? t('取消常用') : t('設為常用司機') }}
        </button>
      </div>
    </section>

    <p v-if="loaded && !error && drivers.length === 0" class="card muted">{{ t('還沒有司機接過你的單。有人接了之後，會出現在這裡。') }}</p>
  </div>
</template>

<style scoped>
.my-drivers__about {
  margin: 0 var(--space-xs) var(--space-md);
}
.my-drivers__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.my-drivers__car {
  margin: var(--space-xs) 0 0;
}
.my-drivers__record {
  margin: var(--space-sm) 0 0;
  font-weight: 600;
}
.my-drivers__last {
  margin: var(--space-xs) 0 0;
}
.my-drivers__note {
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-card);
  background: var(--color-tint);
}
.my-drivers__note-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}
.my-drivers__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-md);
}
</style>

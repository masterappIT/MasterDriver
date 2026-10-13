<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import BrandMark from '../components/BrandMark.vue';
import { fromLocalInput, toLocalInput } from '../format';
import { t } from '../i18n';

interface Page {
  code: string;
  name: string | null;
  vehicleType: string | null;
  seats: number | null;
  color: string | null;
  intro: string;
  routes: string[];
  languages: string[];
  regions: string[];
  wechatId: string | null;
  whatsapp: string | null;
  photos: { id: string; url: string }[];
  completedTrips: number;
  published: boolean;
  mine: boolean;
}

/** 名片頁: a driver's own public page. A passenger reads it and may ask for a trip, without an account. */
const route = useRoute();
const router = useRouter();
const code = String(route.params.code);
const page = ref<Page | null>(null);
const error = ref('');
const formError = ref('');
const busy = ref(false);
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
const form = reactive({
  pickupAt: toLocalInput(tomorrow),
  origin: '',
  destination: '',
  passengers: '1',
  luggage: '0',
  passengerName: '',
  passengerContact: '',
  notes: '',
});

/** "7座商務車・黑"; the seat count is left out when the vehicle type already says it. */
function vehicleLine(shown: Page) {
  const seats = shown.seats ? `${shown.seats}座` : '';
  return [shown.vehicleType, shown.vehicleType?.includes(seats) ? '' : seats, shown.color].filter(Boolean).join('・');
}

async function submit() {
  formError.value = '';
  busy.value = true;
  try {
    const source = typeof route.query.from === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(route.query.from) ? route.query.from : undefined;
    const sent = await api<{ code: string }>('POST', `/public/profiles/${code}/bookings`, {
      pickupAt: fromLocalInput(form.pickupAt),
      origin: form.origin,
      destination: form.destination,
      passengers: Number(form.passengers),
      luggage: Number(form.luggage),
      passengerName: form.passengerName,
      passengerContact: form.passengerContact,
      notes: form.notes,
      source,
    });
    await router.push(`/b/${sent.code}?sent=1`);
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    page.value = await api<Page>('GET', `/public/profiles/${code}`);
    document.title = `${page.value.name ?? t('司機')}｜MasterDriver ${t('跨境師傅幫')}`;
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page profile">
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="page">
      <div v-if="page.mine && !page.published" class="notice">
        {{ t('這是預覽，只有你看得到。到「我的 → 我的名片頁」公開後，乘客才打得開。') }}
      </div>

      <section class="card">
        <h1 class="profile__name">{{ page.name ? t(page.name) : t('司機') }}</h1>
        <p class="muted">
          {{ t(vehicleLine(page)) }}
        </p>
        <p v-if="page.completedTrips > 0" class="profile__trips">{{ t(`已在師傅幫完成 ${page.completedTrips} 張單`) }}</p>
        <p v-if="page.intro" class="profile__intro">{{ t(page.intro) }}</p>
      </section>

      <section v-if="page.photos.length" class="profile__photos">
        <img v-for="photo in page.photos" :key="photo.id" class="profile__photo" :src="photo.url" :alt="t('車輛照片')" loading="lazy" />
      </section>

      <section v-if="page.routes.length || page.regions.length || page.languages.length" class="card">
        <template v-if="page.routes.length">
          <h2>{{ t('常走路線') }}</h2>
          <ul class="profile__list">
            <li v-for="item in page.routes" :key="item">{{ t(item) }}</li>
          </ul>
        </template>
        <p v-if="page.regions.length" class="profile__line"><span class="muted">{{ t('服務地區') }}：</span>{{ t(page.regions.join('、')) }}</p>
        <p v-if="page.languages.length" class="profile__line"><span class="muted">{{ t('語言') }}：</span>{{ t(page.languages.join('、')) }}</p>
      </section>

      <section v-if="page.wechatId || page.whatsapp" class="card">
        <h2>{{ t('直接聯絡') }}</h2>
        <p v-if="page.wechatId" class="profile__line">{{ t('微信') }}：{{ page.wechatId }}</p>
        <p v-if="page.whatsapp" class="profile__line">
          WhatsApp：<a :href="`https://wa.me/${page.whatsapp.replace(/[^0-9]/g, '')}`" target="_blank" rel="noopener">{{ page.whatsapp }}</a>
        </p>
      </section>

      <form v-if="page.published" class="card" @submit.prevent="submit">
        <h2>{{ t('預約行程') }}</h2>
        <p class="hint profile__form-hint">{{ t('送出後司機會回覆報價。不用註冊，也不用先付款。') }}</p>
        <div v-if="formError" class="notice error">{{ formError }}</div>
        <label class="field">{{ t('日期時間（香港時間）') }}<input v-model="form.pickupAt" class="input" type="datetime-local" required /></label>
        <label class="field">{{ t('出發地') }}<input v-model="form.origin" class="input" maxlength="120" :placeholder="t('例如：香港國際機場')" required /></label>
        <label class="field">{{ t('目的地') }}<input v-model="form.destination" class="input" maxlength="120" :placeholder="t('例如：深圳灣口岸')" required /></label>
        <div class="row">
          <label class="field profile__half">{{ t('人數') }}<input v-model="form.passengers" class="input" type="number" min="1" max="60" inputmode="numeric" required /></label>
          <label class="field profile__half">{{ t('行李') }}<input v-model="form.luggage" class="input" type="number" min="0" max="60" inputmode="numeric" /></label>
        </div>
        <label class="field">{{ t('稱呼（選填）') }}<input v-model="form.passengerName" class="input" maxlength="40" /></label>
        <label class="field">
          {{ t('你的電話或微信') }}
          <input v-model="form.passengerContact" class="input" maxlength="60" required />
          <span class="hint">{{ t('只有這位司機看得到，用來回覆你。') }}</span>
        </label>
        <label class="field">{{ t('備註（選填）') }}<textarea v-model="form.notes" class="textarea" maxlength="500" :placeholder="t('例如：航班號碼、需要兒童座椅')" /></label>
        <button class="button block large" type="submit" :disabled="busy">{{ t('送出預約') }}</button>
      </form>

      <footer class="profile__footer hint">
        <p>{{ t('這是司機自己的頁面。師傅幫不審核司機，也不擔保服務；車費和行程由你和司機自行約定，平台不收款。') }}</p>
        <p>
          <RouterLink to="/support">{{ t('檢舉這個頁面') }}</RouterLink>
        </p>
        <RouterLink to="/" class="profile__brand"><BrandMark /><span>{{ t('由 MasterDriver 跨境師傅幫提供') }}</span></RouterLink>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.profile {
  padding-bottom: calc(var(--space-xl) + var(--safe-bottom));
}
.profile__name {
  margin-bottom: var(--space-xs);
}
.profile__trips {
  display: inline-block;
  margin: var(--space-sm) 0 0;
  padding: 2px var(--space-md);
  border-radius: var(--radius-pill);
  background: var(--color-tint);
  color: var(--color-primary-dark);
  font-size: var(--font-label);
  font-weight: 600;
}
.profile__intro {
  margin: var(--space-md) 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.profile__photos {
  display: flex;
  gap: var(--space-sm);
  overflow-x: auto;
  margin-bottom: var(--space-lg);
  scroll-snap-type: x mandatory;
}
.profile__photo {
  flex: 0 0 82%;
  height: 200px;
  object-fit: cover;
  border-radius: var(--radius-card);
  scroll-snap-align: start;
  background: var(--color-divider);
}
.profile__photo:only-child {
  flex-basis: 100%;
}
.profile__list {
  margin: 0 0 var(--space-md);
  padding-left: var(--space-lg);
}
.profile__line {
  margin: var(--space-xs) 0;
}
.profile__form-hint {
  margin: 0 0 var(--space-md);
}
.profile__half {
  flex: 1;
  min-width: 0;
}
.profile__footer {
  margin-top: var(--space-lg);
}
.profile__brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--color-text-muted);
}
</style>

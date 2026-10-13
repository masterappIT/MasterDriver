<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import BrandMark from '../components/BrandMark.vue';
import { copyText } from '../device';
import { fromLocalInput, plateKind, toLocalInput } from '../format';
import PageBack from '../components/PageBack.vue';
import { t } from '../i18n';
import { toast } from '../toast';

interface Page {
  code: string;
  name: string | null;
  vehicleType: string | null;
  seats: number | null;
  color: string | null;
  plateType?: 'SINGLE' | 'DUAL' | 'TRIPLE' | null;
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
/** The booking form, and whether it is on screen (the bottom button hides while it is). */
const formEl = ref<HTMLFormElement | null>(null);
const formInView = ref(false);
let watcher: IntersectionObserver | undefined;
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
  return [shown.vehicleType, shown.vehicleType?.includes(seats) ? '' : seats, shown.color, plateKind(shown)].filter(Boolean).join('・');
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

/** The bottom button: bring the form up and put the cursor in its first field. */
/** A WeChat ID is added by searching it, so the passenger needs it copied. */
async function copyWechat(id: string) {
  toast((await copyText(id)) ? '已複製微信號，到微信搜尋加好友' : '複製失敗，請長按微信號自行複製');
}

function goToForm() {
  formEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  formEl.value?.querySelector('input')?.focus({ preventScroll: true });
}

onMounted(async () => {
  try {
    page.value = await api<Page>('GET', `/public/profiles/${code}`);
    document.title = `${page.value.name ?? t('司機')}｜MasterDriver ${t('跨境師傅幫')}`;
  } catch (e) {
    error.value = errorText(e);
  }
  await nextTick();
  if (formEl.value && 'IntersectionObserver' in window) {
    watcher = new IntersectionObserver(([entry]) => (formInView.value = entry.isIntersecting), { threshold: 0.15 });
    watcher.observe(formEl.value);
  }
});
onBeforeUnmount(() => watcher?.disconnect());
</script>

<template>
  <div class="page profile">
    <PageBack fallback="/app/profile-page" only-in-app />
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="page">
      <div v-if="page.mine && !page.published" class="notice">
        {{ t('這是預覽，只有你看得到。到「我的」裡的「我的名片頁」公開後，乘客才打得開。') }}
      </div>

      <section v-if="page.photos.length" class="profile__photos">
        <img v-for="photo in page.photos" :key="photo.id" class="profile__photo" :src="photo.url" :alt="t('車輛照片')" loading="lazy" />
      </section>

      <section class="card">
        <h1 class="profile__name">{{ page.name ? t(page.name) : t('司機') }}</h1>
        <p class="profile__car">{{ t(vehicleLine(page)) }}</p>
        <p v-if="page.completedTrips > 0" class="profile__trips">{{ t(`已在師傅幫完成 ${page.completedTrips} 張單`) }}</p>
        <p v-if="page.intro" class="profile__intro">{{ t(page.intro) }}</p>
        <p v-if="page.regions.length || page.languages.length" class="profile__facts">
          <span v-if="page.regions.length">{{ t(`服務${page.regions.join('、')}`) }}</span>
          <span v-if="page.languages.length">{{ t(`會說${page.languages.join('、')}`) }}</span>
        </p>
      </section>

      <section v-if="page.routes.length" class="card">
        <span class="section-label">{{ t('常走路線') }}</span>
        <ul class="profile__routes">
          <li v-for="item in page.routes" :key="item">{{ t(item) }}</li>
        </ul>
      </section>

      <section v-if="page.wechatId || page.whatsapp" class="card">
        <span class="section-label">{{ t('直接聯絡') }}</span>
        <div v-if="page.wechatId" class="profile__contact">
          <span><small>{{ t('微信') }}</small>{{ page.wechatId }}</span>
          <button class="chip" type="button" @click="copyWechat(page.wechatId)">{{ t('複製') }}</button>
        </div>
        <div v-if="page.whatsapp" class="profile__contact">
          <span><small>WhatsApp</small>{{ page.whatsapp }}</span>
          <a class="chip" :href="`https://wa.me/${page.whatsapp.replace(/[^0-9]/g, '')}`" target="_blank" rel="noopener">{{ t('打開') }}</a>
        </div>
      </section>

      <form v-if="page.published" ref="formEl" class="card profile__form" @submit.prevent="submit">
        <span class="section-label">{{ t('預約行程') }}</span>
        <p class="hint profile__form-hint">{{ t('送出後司機會回覆報價。不用註冊，也不用先付款。') }}</p>
        <div v-if="formError" class="notice error">{{ formError }}</div>
        <label class="line-field">
          <span>{{ t('日期時間（香港時間）') }}</span>
          <input v-model="form.pickupAt" class="line-input" type="datetime-local" required />
        </label>
        <ol class="route-inputs profile__route">
          <li class="route-inputs__stop route-inputs__stop--origin">
            <input v-model="form.origin" class="line-input" maxlength="120" :aria-label="t('出發地')" :placeholder="t('從哪裡出發，例如：香港國際機場')" required />
          </li>
          <li class="route-inputs__stop route-inputs__stop--destination">
            <input v-model="form.destination" class="line-input" maxlength="120" :aria-label="t('目的地')" :placeholder="t('去哪裡，例如：深圳灣口岸')" required />
          </li>
        </ol>
        <div class="profile__load">
          <label class="line-field">
            <span>{{ t('人數') }}</span>
            <input v-model="form.passengers" class="line-input" type="number" min="1" max="60" inputmode="numeric" required />
          </label>
          <label class="line-field">
            <span>{{ t('行李') }}</span>
            <input v-model="form.luggage" class="line-input" type="number" min="0" max="60" inputmode="numeric" />
          </label>
        </div>
        <input v-model="form.passengerName" class="line-input profile__gap" maxlength="40" :aria-label="t('稱呼')" :placeholder="t('怎樣稱呼你（選填）')" />
        <label class="line-field">
          <span>{{ t('你的電話或微信，只有這位司機看得到') }}</span>
          <input v-model="form.passengerContact" class="line-input" maxlength="60" required />
        </label>
        <label class="line-field">
          <span>{{ t('備註（選填）') }}</span>
          <textarea v-model="form.notes" class="line-input" maxlength="500" :placeholder="t('例如：航班號碼、需要兒童座椅')" />
        </label>
        <button class="button block large" type="submit" :disabled="busy">{{ t('送出預約') }}</button>
      </form>

      <footer class="profile__footer hint">
        <p>{{ t('這是司機自己的頁面。師傅幫不審核司機，也不擔保服務；車費和行程由你和司機自行約定，平台不收款。') }}</p>
        <p>
          <RouterLink to="/support">{{ t('檢舉這個頁面') }}</RouterLink>
        </p>
        <RouterLink to="/" class="profile__brand"><BrandMark /><span>{{ t('由 MasterDriver 跨境師傅幫提供') }}</span></RouterLink>
      </footer>

      <div v-if="page.published && !formInView" class="action-bar">
        <button class="button block large" type="button" @click="goToForm">{{ t('預約這位師傅') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.profile {
  /* Room for the bottom button. */
  padding-bottom: calc(96px + var(--safe-bottom));
}
.profile__form {
  scroll-margin-top: var(--space-lg);
}
.profile__name {
  margin: 0;
  font-size: 24px;
}
.profile__car {
  margin: var(--space-xs) 0 0;
  color: var(--color-label);
  font-weight: 600;
}
.profile__trips {
  display: inline-block;
  margin: var(--space-sm) 0 0;
  padding: 2px var(--space-md);
  border-radius: var(--radius-pill);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  font-size: var(--font-label);
  font-weight: 600;
}
.profile__intro {
  margin: var(--space-md) 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* "服務香港、深圳 · 會說粵語、普通話" as one quiet line. */
.profile__facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-md);
  margin: var(--space-md) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.profile__photos {
  display: flex;
  gap: var(--space-sm);
  overflow-x: auto;
  margin-bottom: var(--space-lg);
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}
.profile__photos::-webkit-scrollbar {
  display: none;
}
.profile__photo {
  flex: 0 0 86%;
  height: 220px;
  object-fit: cover;
  border-radius: var(--radius-card);
  scroll-snap-align: start;
  background: var(--color-divider);
}
.profile__photo:only-child {
  flex-basis: 100%;
}
.profile__routes {
  margin: 0;
  padding: 0;
  list-style: none;
}
.profile__routes li {
  padding: var(--space-sm) 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.profile__routes li + li {
  border-top: 1px solid var(--color-divider);
}
.profile__contact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
}
.profile__contact + .profile__contact {
  border-top: 1px solid var(--color-divider);
}
.profile__contact > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.profile__contact small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
.profile__form-hint {
  margin: 0 0 var(--space-lg);
}
.profile__route {
  margin-bottom: var(--space-lg);
}
.profile__load {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}
.profile__gap {
  margin-bottom: var(--space-lg);
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

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, apiFetch, errorText } from '../api';
import { copyText } from '../device';
import PageBack from '../components/PageBack.vue';
import AppIcon from '../components/AppIcon.vue';
import { t } from '../i18n';
import { imageForSupport } from '../support';
import { toast } from '../toast';

interface MyPage {
  code: string;
  url: string;
  published: boolean;
  /** 下架 by the platform after a complaint; it cannot be published until restored. */
  blocked: { at: string; reason: string } | null;
  hasDriverProfile: boolean;
  intro: string;
  routes: string[];
  languages: string[];
  regions: string[];
  wechatId: string | null;
  whatsapp: string | null;
  photos: { id: string; url: string }[];
  completedTrips: number;
  photoLimit: number;
  photosAvailable: boolean;
}

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const COMMON_LANGUAGES = ['粵語', '普通話', 'English'];

/** The driver edits their own 名片頁 here. Lists are typed one item per line. */
const page = ref<MyPage | null>(null);
const error = ref('');
const busy = ref(false);
const picker = ref<HTMLInputElement | null>(null);
const form = reactive({ intro: '', routes: '', regions: '', languages: [] as string[], otherLanguages: '', wechatId: '', whatsapp: '' });

/**
 * The page opens on sharing: the content and the photos are folded into one line each, and open
 * by themselves only while nothing is filled in yet. Saving folds the content again.
 */
const contentOpen = ref(false);
const photosOpen = ref(false);
const contentSummary = computed(() => {
  const shown = page.value;
  if (!shown) return '';
  const parts = [
    shown.intro ? '介紹' : '',
    shown.routes.length ? `${shown.routes.length} 條路線` : '',
    shown.regions.length ? `${shown.regions.length} 個地區` : '',
    shown.languages.length ? `${shown.languages.length} 種語言` : '',
    shown.wechatId ? '微信號' : '',
    shown.whatsapp ? 'WhatsApp' : '',
  ].filter(Boolean);
  return parts.length ? parts.join('、') : '還沒填寫';
});

const lines = (text: string) => text.split(/\n|、|,|，/).map((item) => item.trim()).filter(Boolean);

function toggleLanguage(language: string) {
  form.languages = form.languages.includes(language) ? form.languages.filter((item) => item !== language) : [...form.languages, language];
}

function fill(loaded: MyPage) {
  page.value = loaded;
  form.intro = loaded.intro;
  form.routes = loaded.routes.join('\n');
  form.regions = loaded.regions.join('、');
  form.languages = loaded.languages.filter((language) => COMMON_LANGUAGES.includes(language));
  form.otherLanguages = loaded.languages.filter((language) => !COMMON_LANGUAGES.includes(language)).join('、');
  form.wechatId = loaded.wechatId ?? '';
  form.whatsapp = loaded.whatsapp ?? '';
}

async function save(published?: boolean) {
  error.value = '';
  busy.value = true;
  try {
    const wasEditing = published === undefined;
    fill(
      await api<MyPage>('PUT', '/me/profile-page', {
        intro: form.intro,
        routes: lines(form.routes),
        regions: lines(form.regions),
        languages: [...form.languages, ...lines(form.otherLanguages)],
        wechatId: form.wechatId,
        whatsapp: form.whatsapp,
        ...(published === undefined ? {} : { published }),
      }),
    );
    if (wasEditing) contentOpen.value = false;
    toast(published === true ? '已公開，乘客可以打開了' : published === false ? '已改為不公開' : '已儲存');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function picked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  busy.value = true;
  try {
    const image = await imageForSupport(file);
    if (image.size > PHOTO_MAX_BYTES) throw new Error('圖片太大，上限 5 MB');
    const response = await apiFetch('POST', '/me/profile-page/photos', { headers: { 'content-type': image.type || 'image/jpeg' }, body: image });
    const updated = (await response.json()) as MyPage;
    if (page.value) page.value.photos = updated.photos;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

async function removePhoto(id: string) {
  if (!confirm(t('確定刪除這張照片？'))) return;
  try {
    const updated = await api<MyPage>('DELETE', `/me/profile-page/photos/${id}`);
    if (page.value) page.value.photos = updated.photos;
  } catch (e) {
    error.value = errorText(e);
  }
}

async function copyLink() {
  if (!page.value) return;
  toast((await copyText(page.value.url)) ? '已複製名片頁連結' : '複製失敗，請長按連結自行複製');
}

onMounted(async () => {
  try {
    fill(await api<MyPage>('GET', '/me/profile-page'));
    contentOpen.value = contentSummary.value === '還沒填寫';
    photosOpen.value = Boolean(page.value?.photosAvailable && !page.value.photos.length);
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page my-page">
    <!-- Opened from 首頁, 我的, 預約, the guide and the share page: 返回 goes back to whichever it was. -->
    <PageBack :title="t('我的名片頁')" fallback="/app/me" history />
    <div v-if="error" class="notice error">{{ error }}</div>
    <RouterLink class="my-page__guide" to="/app/guide/customers">{{ t('名片頁可以做什麼？連結放在哪裡？看教學') }}</RouterLink>

    <template v-if="page">
      <section class="card">
        <div class="my-page__head">
          <span class="my-page__state" :class="{ 'my-page__state--on': page.published }">{{ page.blocked ? t('已被下架') : page.published ? t('已公開') : t('未公開') }}</span>
          <span class="hint">{{ page.published ? t('有連結的人都打得開') : t('現在只有你看得到') }}</span>
        </div>
        <div v-if="page.blocked" class="notice error">
          {{ t(`平台收到投訴後下架了你的名片頁，原因：${page.blocked.reason}。修改內容後請聯絡客服恢復，恢復前不能公開。`) }}
          <RouterLink to="/support">{{ t('聯絡客服') }}</RouterLink>
        </div>
        <p class="my-page__url">{{ page.url }}</p>
        <div class="my-page__actions">
          <button class="button" type="button" @click="copyLink">{{ t('複製連結') }}</button>
          <RouterLink class="button secondary" :to="`/p/${page.code}`">{{ t('預覽') }}</RouterLink>
        </div>
        <p v-if="!page.hasDriverProfile" class="my-page__notice">{{ t('公開之前，請先在「我的」填寫司機資料（姓名、車型）。') }}</p>
        <p class="hint my-page__from">{{ t('姓名、車型取自司機資料，完成單數由系統計算。') }}</p>
      </section>

      <details class="card my-page__fold" :open="contentOpen" @toggle="contentOpen = ($event.target as HTMLDetailsElement).open">
        <summary>
          <span class="my-page__fold-text">
            <strong>{{ t('名片內容') }}</strong>
            <span class="hint">{{ t(contentSummary) }}</span>
          </span>
          <AppIcon name="chevron" class="my-page__fold-arrow" />
        </summary>
      <form @submit.prevent="save()">
        <label class="line-field">
          <span>{{ t('介紹自己') }}</span>
          <textarea v-model="form.intro" class="line-input" maxlength="500" :placeholder="t('例如：十年跨境接送經驗，準時、車廂整潔')" />
        </label>
        <label class="line-field">
          <span>{{ t('常走路線，一行一條，最多 8 條') }}</span>
          <textarea v-model="form.routes" class="line-input" :placeholder="t('香港機場 往返 深圳灣口岸\n香港市區 往返 澳門')" />
        </label>
        <label class="line-field">
          <span>{{ t('服務地區') }}</span>
          <input v-model="form.regions" class="line-input" :placeholder="t('香港、深圳、澳門、珠海')" />
        </label>
        <div class="line-field">
          <span>{{ t('會說的語言') }}</span>
          <div class="chips my-page__languages">
            <button
              v-for="language in COMMON_LANGUAGES"
              :key="language"
              class="chip"
              :class="{ 'chip--on': form.languages.includes(language) }"
              type="button"
              :aria-pressed="form.languages.includes(language)"
              @click="toggleLanguage(language)"
            >
              {{ t(language) }}
            </button>
          </div>
          <input v-model="form.otherLanguages" class="line-input" :aria-label="t('其他語言')" :placeholder="t('其他語言（選填）')" />
        </div>
        <label class="line-field">
          <span>{{ t('微信號（選填）') }}</span>
          <input v-model="form.wechatId" class="line-input" maxlength="60" />
        </label>
        <label class="line-field">
          <span>{{ t('WhatsApp 號碼（選填）') }}</span>
          <input v-model="form.whatsapp" class="line-input" maxlength="30" placeholder="+852 …" />
        </label>
        <p class="hint">{{ t('微信號和 WhatsApp：公開後顯示在名片頁；不公開時，和你有單往來的司機也看得到。') }}</p>
        <button class="button block" type="submit" :disabled="busy">{{ t('儲存') }}</button>
      </form>
      </details>

      <details class="card my-page__fold" :open="photosOpen" @toggle="photosOpen = ($event.target as HTMLDetailsElement).open">
        <summary>
          <span class="my-page__fold-text">
            <strong>{{ t('車輛照片') }}</strong>
            <span class="hint">{{ page.photos.length ? t(`${page.photos.length} 張，最多 ${page.photoLimit} 張`) : t(`還沒有照片，最多 ${page.photoLimit} 張`) }}</span>
          </span>
          <AppIcon name="chevron" class="my-page__fold-arrow" />
        </summary>
        <p v-if="!page.photosAvailable" class="muted">{{ t('暫時無法上傳照片。') }}</p>
        <div class="my-page__photos">
          <div v-for="photo in page.photos" :key="photo.id" class="my-page__photo">
            <img :src="photo.url" :alt="t('車輛照片')" />
            <button class="my-page__remove" type="button" :aria-label="t('刪除這張照片')" @click="removePhoto(photo.id)">
              <AppIcon name="close" :size="16" />
            </button>
          </div>
          <button
            v-if="page.photosAvailable && page.photos.length < page.photoLimit"
            class="my-page__add"
            type="button"
            :disabled="busy"
            @click="picker?.click()"
          >
            <AppIcon name="add" :size="24" />
            <span>{{ t('加照片') }}</span>
          </button>
        </div>
        <input ref="picker" class="my-page__picker" type="file" accept="image/*" @change="picked" />
        <p class="hint">{{ t('只放自己車輛的照片，不要拍到他人車牌。你接單後，乘客在確認頁也看得到，方便認車。') }}</p>
      </details>

      <button v-if="!page.published" class="button block large" type="button" :disabled="busy || !page.hasDriverProfile || Boolean(page.blocked)" @click="save(true)">
        {{ t('儲存並公開') }}
      </button>
      <button v-else class="my-page__unpublish" type="button" :disabled="busy" @click="save(false)">{{ t('改為不公開') }}</button>
    </template>
  </div>
</template>

<style scoped>
.my-page__guide {
  display: block;
  margin: 0 var(--space-xs) var(--space-md);
  font-size: var(--font-label);
  font-weight: 600;
}
.my-page__head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.my-page__state {
  padding: 2px var(--space-sm);
  border-radius: var(--radius-pill);
  background: var(--color-divider);
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 700;
}
.my-page__state--on {
  background: var(--status-confirmed-tint);
  color: var(--status-confirmed);
}
.my-page__url {
  margin: 0 0 var(--space-md);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.my-page__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}
.my-page__notice {
  margin: var(--space-md) 0 0;
  color: var(--color-gold-ink);
  font-size: var(--font-label);
}
.my-page__from {
  margin: var(--space-md) 0 0;
}
.my-page__fold summary {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
  list-style: none;
}
.my-page__fold summary::-webkit-details-marker {
  display: none;
}
.my-page__fold[open] summary {
  margin-bottom: var(--space-md);
}
.my-page__fold-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.my-page__fold-arrow {
  color: var(--color-text-muted);
  transition: transform 0.15s;
}
.my-page__fold[open] .my-page__fold-arrow {
  transform: rotate(90deg);
}
.my-page__languages {
  margin: var(--space-sm) 0 var(--space-xs);
}
.my-page__photos {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.my-page__photo {
  position: relative;
}
.my-page__photo img,
.my-page__add {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--radius-input);
}
.my-page__photo img {
  object-fit: cover;
  background: var(--color-divider);
}
.my-page__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(20, 32, 51, 0.6);
  color: var(--color-on-primary);
  cursor: pointer;
}
.my-page__add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 1.5px dashed var(--color-border);
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-size: var(--font-caption);
  font-weight: 600;
  cursor: pointer;
}
.my-page__picker {
  display: none;
}
.my-page__unpublish {
  display: block;
  margin: 0 auto;
  min-height: 44px;
  padding: 0 var(--space-xl);
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  cursor: pointer;
}
</style>

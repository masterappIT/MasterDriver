<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
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

const lines = (text: string) => text.split(/\n|、|,|，/).map((item) => item.trim()).filter(Boolean);

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
  } catch (e) {
    error.value = errorText(e);
  }
});
</script>

<template>
  <div class="page my-page">
    <PageBack :title="t('我的名片頁')" fallback="/app/me" />
    <div v-if="error" class="notice error">{{ error }}</div>

    <template v-if="page">
      <section class="card">
        <p class="my-page__state">{{ page.published ? t('已公開：有連結的人都打得開') : t('未公開：只有你看得到') }}</p>
        <p class="my-page__url">{{ page.url }}</p>
        <div class="row">
          <button class="button secondary" type="button" @click="copyLink">{{ t('複製連結') }}</button>
          <RouterLink class="button secondary" :to="`/p/${page.code}`">{{ t('預覽') }}</RouterLink>
          <button v-if="page.published" class="button secondary" type="button" :disabled="busy" @click="save(false)">{{ t('改為不公開') }}</button>
        </div>
        <p v-if="!page.hasDriverProfile" class="notice my-page__notice">{{ t('公開之前，請先在「我的」填寫司機資料（姓名、車型）。') }}</p>
        <p class="hint">
          {{ t('姓名、車型、座位、車色取自你的司機資料。') }}
          {{ page.completedTrips > 0 ? t(`頁面會顯示你已在師傅幫完成 ${page.completedTrips} 張單。`) : t('完成的單數由系統計算，有完成的單之後才會顯示。') }}
        </p>
      </section>

      <form class="card" @submit.prevent="save()">
        <label class="field">
          {{ t('自我介紹') }}
          <textarea v-model="form.intro" class="textarea" maxlength="500" :placeholder="t('例如：十年跨境接送經驗，準時、車廂整潔')" />
        </label>
        <label class="field">
          {{ t('常走路線（一行一條，最多 8 條）') }}
          <textarea v-model="form.routes" class="textarea" :placeholder="t('香港機場 往返 深圳灣口岸\n香港市區 往返 澳門')" />
        </label>
        <label class="field">{{ t('服務地區（用頓號分隔）') }}<input v-model="form.regions" class="input" :placeholder="t('香港、深圳、澳門、珠海')" /></label>
        <div class="field">
          {{ t('語言') }}
          <div class="row">
            <label v-for="language in COMMON_LANGUAGES" :key="language" class="row">
              <input v-model="form.languages" type="checkbox" :value="language" /> {{ t(language) }}
            </label>
          </div>
          <input v-model="form.otherLanguages" class="input" :placeholder="t('其他語言（選填）')" />
        </div>
        <label class="field">{{ t('微信號（選填，會公開顯示）') }}<input v-model="form.wechatId" class="input" maxlength="60" /></label>
        <label class="field">{{ t('WhatsApp 號碼（選填，會公開顯示）') }}<input v-model="form.whatsapp" class="input" maxlength="30" placeholder="+852 …" /></label>
        <button class="button block" type="submit" :disabled="busy">{{ t('儲存') }}</button>
      </form>

      <section class="card">
        <h2>{{ t(`車輛照片（最多 ${page.photoLimit} 張）`) }}</h2>
        <p v-if="!page.photosAvailable" class="muted">{{ t('暫時無法上傳照片。') }}</p>
        <div class="my-page__photos">
          <div v-for="photo in page.photos" :key="photo.id" class="my-page__photo">
            <img :src="photo.url" :alt="t('車輛照片')" />
            <button class="chip" type="button" @click="removePhoto(photo.id)">{{ t('刪除') }}</button>
          </div>
        </div>
        <button
          v-if="page.photosAvailable && page.photos.length < page.photoLimit"
          class="button secondary block"
          type="button"
          :disabled="busy"
          @click="picker?.click()"
        >
          <AppIcon name="add" :size="18" />{{ t('加照片') }}
        </button>
        <input ref="picker" class="my-page__picker" type="file" accept="image/*" @change="picked" />
        <p class="hint">{{ t('請只放自己車輛的照片，不要拍到乘客或他人的車牌。') }}</p>
      </section>

      <button v-if="!page.published" class="button block large" type="button" :disabled="busy || !page.hasDriverProfile" @click="save(true)">
        {{ t('儲存並公開') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.my-page__state {
  margin: 0 0 var(--space-xs);
  font-weight: 600;
}
.my-page__url {
  margin: 0 0 var(--space-md);
  overflow-wrap: anywhere;
  color: var(--color-text-secondary);
}
.my-page__notice {
  margin: var(--space-md) 0 0;
}
.my-page__photos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.my-page__photo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
}
.my-page__photo img {
  width: 104px;
  height: 78px;
  object-fit: cover;
  border-radius: var(--radius-input);
  background: var(--color-divider);
}
.my-page__picker {
  display: none;
}
</style>

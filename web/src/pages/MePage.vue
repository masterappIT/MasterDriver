<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, session, signOut } from '../api';
import BottomSheet from '../components/BottomSheet.vue';
import GroupInvites from '../components/GroupInvites.vue';
import MenuRow from '../components/MenuRow.vue';
import PlateTag from '../components/PlateTag.vue';
import RevealSelect from '../components/RevealSelect.vue';
import ProfileForm from '../components/ProfileForm.vue';
import { money, plateKind } from '../format';
import { language, setLanguage, t } from '../i18n';
import { toast } from '../toast';
import { refreshUnread, unread } from '../unread';

interface Settings {
  support: { wechatId: string | null; whatsapp: string | null };
}

const router = useRouter();
const reveal = ref<number | null>(60);
const poolByDefault = ref(false);

async function savePool() {
  try {
    await api('PUT', '/me/preferences', { poolByDefault: poolByDefault.value });
    toast('已更新預設值');
  } catch {
    poolByDefault.value = !poolByDefault.value;
    toast('更新失敗，請再試一次');
  }
}

async function saveReveal(value: number | null) {
  try {
    await api('PUT', '/me/preferences', { contactRevealMinutes: value });
    toast('已更新預設值');
  } catch {
    toast('更新失敗，請再試一次');
  }
}
const editing = ref(false);
const settings = ref<Settings | null>(null);
/** The Master Travel entry; the API sends a link only to drivers putting out more than 30 trips a month. */
const upgradeUrl = ref<string | null>(null);
const credits = ref<{ balance: { amount: number; currency: string }; serviceFee: { enabled: boolean; feePerOrder: { amount: number; currency: string }; exempt: boolean } } | null>(null);

/** "Alphard・7座・黑色・兩地牌" under the driver's name. */
const vehicle = computed(() => {
  const profile = session.profile;
  return profile ? [profile.vehicleType, profile.seats ? `${profile.seats}座` : '', profile.color, plateKind(profile)].filter(Boolean).join('・') : '';
});
const supportContacts = computed(() =>
  [settings.value?.support.wechatId ? `${t('微信')} ${settings.value.support.wechatId}` : '', settings.value?.support.whatsapp ? `WhatsApp ${settings.value.support.whatsapp}` : '']
    .filter(Boolean)
    .join('　'),
);

async function logout() {
  await signOut();
  await router.replace('/login');
}

onMounted(async () => {
  const preferences = await api<{ contactRevealMinutes: number | null; poolByDefault: boolean }>('GET', '/me/preferences').catch(() => null);
  if (preferences) {
    reveal.value = preferences.contactRevealMinutes;
    poolByDefault.value = preferences.poolByDefault;
  }
  void refreshUnread();
  void api<{ upgradeUrl: string | null }>('GET', '/me/upgrade')
    .then((offer) => (upgradeUrl.value = offer.upgradeUrl))
    .catch(() => undefined);
  [settings.value, credits.value] = await Promise.all([
    api<Settings>('GET', '/public/settings').catch(() => null),
    api<NonNullable<typeof credits.value>>('GET', '/me/credits').catch(() => null),
  ]);
});
</script>

<template>
  <div class="page me">
    <!-- Who you are, as a few lines rather than a box of fields. -->
    <header class="me__hero">
      <div class="me__name">
        <h1>{{ session.profile?.name ? t(session.profile.name) : t('未填司機資料') }}</h1>
        <button class="me__edit" type="button" @click="editing = true">{{ session.profile ? t('編輯資料') : t('填寫') }}</button>
      </div>
      <span class="me__phone">{{ session.user?.countryCode }} {{ session.user?.phone }}</span>
      <div v-if="session.profile" class="me__car">
        <PlateTag :hk="session.profile.hkPlate" :macau="session.profile.macauPlate" :mainland="session.profile.mainlandPlate" />
        <span v-if="vehicle">{{ t(vehicle) }}</span>
      </div>
      <p v-else class="me__missing">{{ t('搶單和公開名片頁之前，要先填姓名、車牌和車型。') }}</p>
    </header>

    <section class="card me__group">
      <span class="section-label">{{ t('我的客源') }}</span>
      <MenuRow to="/app/profile-page" :title="t('我的名片頁')" :detail="t('放到朋友圈、小紅書或傳給熟客，乘客在上面預約')" />
      <MenuRow
        to="/app/bookings"
        :title="t('預約')"
        :detail="unread.bookings ? t(`${unread.bookings} 個預約有新消息`) : t('乘客從名片頁送來的預約，由你報價')"
        :count="unread.bookings"
      />
      <MenuRow to="/app/passengers" :title="t('客人通訊錄')" :detail="t('你出過的單的乘客，只有你看得到；熟客可以直接出單')" />
    </section>

    <section class="card me__group">
      <span class="section-label">{{ t('出單') }}</span>
      <MenuRow to="/app/payment-methods" :title="t('收款方式')" :detail="t('乘客付車費給你的方式，出單時選擇是否顯示')" />
      <div v-if="credits" class="me__line">
        <span class="me__line-text">
          {{ t('點數餘額') }}
          <small>
            {{
              !credits.serviceFee.enabled
                ? t('目前出單不收服務費')
                : credits.serviceFee.exempt
                  ? t('你目前免收平台服務費')
                  : t(`每出一張單扣 ${money(credits.serviceFee.feePerOrder)}，取消會退回；充值請找客服`)
            }}
          </small>
        </span>
        <strong class="me__balance">{{ money(credits.balance) }}</strong>
      </div>
      <label class="me__line">
        <span class="me__line-text">
          {{ t('乘客電話給接單司機看') }}
          <small>{{ t('你自己隨時看得到；每張單也可以另外選') }}</small>
        </span>
        <RevealSelect v-model="reveal" class="select--inline" @update:model-value="saveReveal" />
      </label>
      <label class="me__line">
        <span class="me__line-text">
          {{ t('新單同時放到接單池') }}
          <small>{{ t('登入的司機都看得到；不放的話只有拿到連結的人看得到') }}</small>
        </span>
        <input v-model="poolByDefault" class="switch" type="checkbox" @change="savePool" />
      </label>
    </section>

    <GroupInvites />

    <section class="card me__group">
      <MenuRow to="/support" :title="t('聯絡客服')" :detail="supportContacts || t('文字、圖片、影片都可以傳')" :count="unread.support" />
      <div class="me__line">
        <span class="me__line-text">{{ t('介面語言') }}</span>
        <span class="segment" role="group" :aria-label="t('介面語言')">
          <button type="button" :aria-pressed="language === 'zh-Hant'" @click="setLanguage('zh-Hant')">繁體</button>
          <button type="button" :aria-pressed="language === 'zh-Hans'" @click="setLanguage('zh-Hans')">简体</button>
        </span>
      </div>
    </section>

    <a v-if="upgradeUrl" class="card me__upgrade" :href="upgradeUrl" target="_blank" rel="noopener">
      <strong>{{ t('單多到要請人了？') }}</strong>
      <span>{{ t('Master Travel 幫車隊和公司做自己品牌的小程序和 App：報價、收款、結算、司機管理一站搞定。') }}</span>
      <span class="me__upgrade-go">{{ t('了解 Master Travel') }}</span>
    </a>

    <button class="me__logout" type="button" @click="logout">{{ t('登出') }}</button>

    <BottomSheet v-if="editing" :title="t('司機資料')" @close="editing = false">
      <ProfileForm @saved="(editing = false), toast('已儲存')" />
    </BottomSheet>
  </div>
</template>

<style scoped>
.me__hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: var(--space-sm) 0 var(--space-xl);
}
.me__name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.me__name h1 {
  margin: 0;
  font-size: 24px;
  overflow-wrap: anywhere;
}
.me__edit {
  flex-shrink: 0;
  min-height: 36px;
  padding: 0 var(--space-lg);
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-tint);
  color: var(--color-primary-dark);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.me__phone {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.me__car {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
  color: var(--color-label);
  font-weight: 600;
}
.me__missing {
  margin: var(--space-xs) 0 0;
  color: var(--color-gold-ink);
  font-size: var(--font-label);
}
.me__group {
  padding-top: var(--space-md);
  padding-bottom: var(--space-sm);
}
/* A sentence on the left and its value or switch on the right. */
.me__line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: 52px;
  padding: var(--space-sm) 0;
  font-weight: 600;
}
.me__line + .me__line,
.menu-row + .me__line {
  border-top: 1px solid var(--color-divider);
}
.me__line-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.me__line-text small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}
.me__balance {
  color: var(--color-gold-ink);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.me__upgrade {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  border: none;
  background: linear-gradient(135deg, var(--color-primary), var(--color-teal));
  color: var(--color-on-primary);
}
.me__upgrade strong {
  font-size: var(--font-body-large);
}
.me__upgrade-go {
  margin-top: var(--space-xs);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.me__logout {
  display: block;
  margin: var(--space-lg) auto 0;
  min-height: 44px;
  padding: 0 var(--space-xl);
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  cursor: pointer;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, session, signOut } from '../api';
import AppIcon from '../components/AppIcon.vue';
import BottomSheet from '../components/BottomSheet.vue';
import GroupInvites from '../components/GroupInvites.vue';
import MenuRow from '../components/MenuRow.vue';
import NotificationBell from '../components/NotificationBell.vue';
import PlateTag from '../components/PlateTag.vue';
import RevealSelect, { revealLabel } from '../components/RevealSelect.vue';
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
/** 出單預設: the two defaults for new orders, opened from one line. */
const defaultsOpen = ref(false);
const defaultsSummary = computed(() => `乘客電話${revealLabel(reveal.value)}｜${poolByDefault.value ? '放接單池' : '不放接單池'}`);

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
    <!-- Who you are: one card, with the plates as they look on the car. -->
    <header class="me__hero">
      <div class="me__name">
        <h1>{{ session.profile?.name ? t(session.profile.name) : t('未填司機資料') }}</h1>
        <span class="me__top-actions">
          <RouterLink class="me__edit" to="/app/profile">{{ session.profile ? t('編輯資料') : t('填寫') }}</RouterLink>
          <NotificationBell />
        </span>
      </div>
      <span class="me__phone">{{ session.user?.countryCode }} {{ session.user?.phone }}</span>
      <div v-if="session.profile" class="me__car">
        <PlateTag :hk="session.profile.hkPlate" :macau="session.profile.macauPlate" :mainland="session.profile.mainlandPlate" />
        <span v-if="vehicle">{{ t(vehicle) }}</span>
      </div>
      <p v-else class="me__missing">{{ t('搶單和公開名片頁之前，要先填姓名、車牌和車型。') }}</p>
    </header>

    <!-- 我的客源 keeps its explanations: a driver new to the tool learns from them what each is for. -->
    <section class="card me__group">
      <span class="section-label">{{ t('我的客源') }}</span>
      <MenuRow to="/app/guide/customers" icon="help" :title="t('怎麼用名片頁找客人')" :detail="t('名片頁可以做什麼、連結放在哪裡、客人怎樣向你詢價')" />
      <MenuRow to="/app/profile-page" icon="card" :title="t('我的名片頁')" :detail="t('放到朋友圈、小紅書或傳給熟客，客人在上面向你詢價')" />
      <MenuRow
        to="/app/bookings"
        icon="event"
        :title="t('等我報價')"
        :detail="unread.bookings ? t(`${unread.bookings} 個客人詢價有新消息`) : t('客人在你的名片頁問價，你回覆報價後可以出單')"
        :count="unread.bookings"
      />
      <MenuRow
        to="/app/carpools"
        icon="people"
        :title="t('拼車')"
        :detail="unread.carpools ? t(`${unread.carpools} 個報位等你確認`) : t('開一趟拼車，把連結發給乘客報位，湊夠了自己開或派出去')"
        :count="unread.carpools"
      />
      <MenuRow
        to="/app/deals"
        icon="tag"
        :title="t('特價車')"
        :detail="unread.deals ? t(`${unread.deals} 組特價車預約等你處理`) : t('開你自己的路線，乘客用專屬連結直接向你下單，不經中介')"
        :count="unread.deals"
      />
      <MenuRow to="/app/passengers" icon="people" :title="t('客人通訊錄')" :detail="t('你出過的單的乘客，只有你看得到；熟客可以直接出單')" />
      <MenuRow to="/app/drivers" icon="taxi" :title="t('我的司機')" :detail="t('接過你的單的司機，設常用司機、寫備註，只有你看得到')" />
    </section>

    <section v-if="credits" class="card me__credits">
      <span class="me__credits-text">
        <span class="section-label">{{ t('點數餘額') }}</span>
        <small>
          {{
            !credits.serviceFee.enabled
              ? t('目前不收服務費')
              : credits.serviceFee.exempt
                ? t('你目前免收平台服務費')
                : t(`每出一張單扣 ${money(credits.serviceFee.feePerOrder)}，取消會退回；充值請找客服`)
          }}
        </small>
      </span>
      <strong class="me__balance">{{ money(credits.balance) }}</strong>
    </section>

    <GroupInvites />

    <section class="card me__group">
      <MenuRow to="/app/payment-methods" icon="wallet" :title="t('收款方式')" :detail="t('乘客付車費給你的方式，出單時選擇是否顯示')" />
      <button class="menu-row me__row-button" type="button" @click="defaultsOpen = true">
        <AppIcon name="tune" class="me__row-icon" />
        <span class="me__line-text">
          <strong>{{ t('出單預設') }}</strong>
          <small>{{ t(defaultsSummary) }}</small>
        </span>
        <AppIcon name="chevron" class="me__row-arrow" />
      </button>
      <MenuRow to="/support" icon="chat" :title="t('聯絡客服')" :detail="supportContacts || undefined" :count="unread.support" />
      <div class="me__line">
        <span class="me__line-lead"><AppIcon name="language" class="me__row-icon" />{{ t('介面語言') }}</span>
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

    <!-- Rarely changed, so they are kept off the page itself. -->
    <BottomSheet v-if="defaultsOpen" :title="t('出單預設')" @close="defaultsOpen = false">
      <p class="hint">{{ t('新出的單會先帶入這兩項，每張單出單時還可以另外選。') }}</p>
      <label class="me__line">
        <span class="me__line-text">
          {{ t('乘客電話給接單司機看') }}
          <small>{{ t('你自己隨時看得到') }}</small>
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
    </BottomSheet>
  </div>
</template>

<style scoped>
.me__hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: var(--space-sm) 0 var(--space-lg);
  padding: var(--space-lg);
  border-radius: var(--radius-card);
  background: var(--color-tint);
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
.me__top-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.me__edit {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 var(--space-lg);
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-card);
  color: var(--color-primary-dark);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.me__credits {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.me__credits-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.me__credits-text small {
  color: var(--color-text-secondary);
  font-size: var(--font-caption);
}
.menu-row + .me__row-button {
  border-top: 1px solid var(--color-divider);
}
.me__row-button {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: 52px;
  padding: var(--space-sm) 0;
  color: var(--color-text);
  width: 100%;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.me__row-button .me__line-text {
  flex: 1;
}
.me__row-button strong {
  font-weight: 600;
}
.me__row-icon {
  flex: none;
  color: var(--color-primary);
}
.me__row-arrow {
  color: var(--color-text-muted);
}
.me__line-lead {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
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
  font-size: 24px;
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

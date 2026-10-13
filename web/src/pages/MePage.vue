<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, session, signOut } from '../api';
import BottomSheet from '../components/BottomSheet.vue';
import PlateTag from '../components/PlateTag.vue';
import ProfileForm from '../components/ProfileForm.vue';
import { money } from '../format';
import { language, setLanguage, t } from '../i18n';
import { toast } from '../toast';

interface Settings {
  upgradeUrl: string | null;
  support: { wechatId: string | null; whatsapp: string | null };
}

const router = useRouter();
const editing = ref(false);
const settings = ref<Settings | null>(null);
const credits = ref<{ balance: { amount: number; currency: string }; serviceFee: { enabled: boolean; feePerOrder: { amount: number; currency: string }; exempt: boolean } } | null>(null);

async function logout() {
  await signOut();
  await router.replace('/login');
}

onMounted(async () => {
  [settings.value, credits.value] = await Promise.all([
    api<Settings>('GET', '/public/settings').catch(() => null),
    api<NonNullable<typeof credits.value>>('GET', '/me/credits').catch(() => null),
  ]);
});
</script>

<template>
  <div class="page">
    <h1>{{ t('我的') }}</h1>

    <section class="card">
      <div class="me__row">
        <div>
          <strong>{{ session.profile?.name ? t(session.profile.name) : t('未填姓名') }}</strong>
          <div class="hint">{{ session.user?.countryCode }} {{ session.user?.phone }}</div>
        </div>
        <button class="button secondary" type="button" @click="editing = true">{{ t('編輯') }}</button>
      </div>
      <PlateTag v-if="session.profile" :hk="session.profile.hkPlate" :macau="session.profile.macauPlate" :mainland="session.profile.mainlandPlate" />
      <p v-if="session.profile?.vehicleType || session.profile?.seats" class="muted">
        {{ t([session.profile?.vehicleType, session.profile?.seats ? `${session.profile.seats}座` : '', session.profile?.color].filter(Boolean).join('・')) }}
      </p>
    </section>

    <section v-if="credits" class="card">
      <div class="me__row">
        <span>{{ t('點數餘額') }}</span>
        <strong>{{ money(credits.balance) }}</strong>
      </div>
      <p class="hint">
        {{
          !credits.serviceFee.enabled
            ? t('目前發單不收服務費。')
            : credits.serviceFee.exempt
              ? t('你目前免收平台服務費。')
              : t(`每發一張單扣 ${money(credits.serviceFee.feePerOrder)}，取消會退回。充值請聯絡客服。`)
        }}
      </p>
    </section>

    <section class="card">
      <div class="me__row">
        <span>{{ t('介面語言') }}</span>
        <div class="row">
          <button class="chip" :class="{ 'me__chip--on': language === 'zh-Hant' }" type="button" @click="setLanguage('zh-Hant')">繁體</button>
          <button class="chip" :class="{ 'me__chip--on': language === 'zh-Hans' }" type="button" @click="setLanguage('zh-Hans')">简体</button>
        </div>
      </div>
    </section>

    <section v-if="settings" class="card">
      <h2>{{ t('客服') }}</h2>
      <p v-if="settings.support.wechatId">{{ t('微信') }}：{{ settings.support.wechatId }}</p>
      <p v-if="settings.support.whatsapp">WhatsApp：{{ settings.support.whatsapp }}</p>
      <p v-if="!settings.support.wechatId && !settings.support.whatsapp" class="muted">{{ t('暫未提供') }}</p>
    </section>

    <a v-if="settings?.upgradeUrl" class="card me__upgrade" :href="settings.upgradeUrl" target="_blank" rel="noopener">
      <strong>{{ t('想擁有自己品牌的小程序和 App？') }}</strong>
      <span class="muted">{{ t('了解 Master Travel：報價、收款、結算、司機管理一站搞定 →') }}</span>
    </a>

    <button class="button secondary block" type="button" @click="logout">{{ t('登出') }}</button>

    <BottomSheet v-if="editing" :title="t('司機資料')" @close="editing = false">
      <ProfileForm @saved="(editing = false), toast('已儲存')" />
    </BottomSheet>
  </div>
</template>

<style scoped>
.me__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-sm);
}
.me__chip--on {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.me__upgrade {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  color: var(--color-text);
}
</style>

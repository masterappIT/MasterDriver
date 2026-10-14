<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { api, session, type AdminRole } from '../api';
import { ask, notify } from '../feedback';
import { dateTime } from '../format';

/**
 * 後台帳號. The look and layout are Master Travel's administrators page (admin/src/pages/administrators/
 * AdministratorsPage.js and styles/administrators.css at c902bb5a, docs/REUSE.md); what it does is this
 * project's: an account gets a one-time password from the system, and there is no edit, unlock or sign-out.
 */
interface Account {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  disabled: boolean;
  lastLoginAt: string | null;
}

const ROLES: { value: AdminRole; label: string; detail: string }[] = [
  { value: 'SUPER_ADMIN', label: '超級管理員', detail: '全部權限，含後台帳號與開發模式登入' },
  { value: 'OPERATOR', label: '營運', detail: '客服、收費控制、充值與贈送、設定' },
  { value: 'SALES', label: '銷售', detail: '只能查看，看不到乘客資料' },
];
const roleLabel = (role: AdminRole) => ROLES.find((item) => item.value === role)?.label ?? role;
const ROLE_TONE: Record<AdminRole, string> = { SUPER_ADMIN: 'purple', OPERATOR: 'confirmed', SALES: '' };

const accounts = ref<Account[] | null>(null);
const loadError = ref('');
const form = ref<{ username: string; displayName: string; role: AdminRole } | null>(null);
const saving = ref(false);
const firstField = ref<HTMLInputElement | null>(null);
/** A one-time password is shown here once and never again. */
const oneTime = ref<{ username: string; password: string; reset: boolean } | null>(null);

const enabledCount = computed(() => accounts.value?.filter((item) => !item.disabled).length ?? 0);
const superCount = computed(() => accounts.value?.filter((item) => item.role === 'SUPER_ADMIN').length ?? 0);

async function load() {
  loadError.value = '';
  try {
    accounts.value = await api<Account[]>('GET', '/accounts');
  } catch (e) {
    loadError.value = (e as Error).message;
  }
}

function openForm() {
  form.value = { username: '', displayName: '', role: 'OPERATOR' };
  void nextTick(() => firstField.value?.focus());
}

async function create() {
  if (!form.value || saving.value) return;
  saving.value = true;
  try {
    const result = await api<{ admin: Account; password: string }>('POST', '/accounts', { ...form.value });
    form.value = null;
    oneTime.value = { username: result.admin.username, password: result.password, reset: false };
    await load();
  } catch (e) {
    notify((e as Error).message, true);
  } finally {
    saving.value = false;
  }
}

async function resetPassword(account: Account) {
  const confirmed = await ask({
    title: '重設密碼',
    text: `為「${account.displayName}」產生新的一次性密碼。對方目前的登入會立即失效，要用新密碼重新登入。`,
    confirm: '重設密碼',
  });
  if (confirmed === null) return;
  try {
    const { password } = await api<{ password: string }>('POST', `/accounts/${account.id}/reset-password`);
    oneTime.value = { username: account.username, password, reset: true };
  } catch (e) {
    notify((e as Error).message, true);
  }
}

async function setDisabled(account: Account, disabled: boolean) {
  const confirmed = await ask(
    disabled
      ? { title: '停用管理員', text: `「${account.displayName}」會立即被登出，之後不能登入後台，直到重新啟用。`, confirm: '停用', danger: true }
      : { title: '啟用管理員', text: `「${account.displayName}」可以再用原來的密碼登入後台。`, confirm: '啟用' },
  );
  if (confirmed === null) return;
  try {
    accounts.value = await api<Account[]>('POST', `/accounts/${account.id}/${disabled ? 'disable' : 'enable'}`);
    notify(disabled ? '已停用' : '已啟用');
  } catch (e) {
    notify((e as Error).message, true);
  }
}

async function copyPassword() {
  if (!oneTime.value) return;
  try {
    await navigator.clipboard.writeText(oneTime.value.password);
    notify('已複製密碼');
  } catch {
    notify('無法自動複製，請手動選取密碼', true);
  }
}

onMounted(load);
</script>

<template>
  <section class="mt-page">
    <div class="mt-heading">
      <div>
        <span class="mt-eyebrow">ACCESS CONTROL</span>
        <h2>後台帳號</h2>
        <p class="mt-muted">管理後台登入帳號、權限角色與啟用狀態，確保每位管理員使用獨立帳號。</p>
      </div>
      <button type="button" class="mt-primary" @click="openForm">＋ 新增管理員</button>
    </div>

    <div v-if="loadError" class="notice error">
      {{ loadError }} <button class="button secondary" type="button" @click="load">重試</button>
    </div>

    <div class="mt-panel">
      <div class="mt-counts">
        <div><strong>{{ accounts?.length ?? 0 }}</strong><span>個管理員帳號</span></div>
        <div><strong>{{ enabledCount }}</strong><span>個啟用中</span></div>
        <div><strong>{{ superCount }}</strong><span>位超級管理員</span></div>
      </div>
      <div class="mt-table-wrap">
        <table class="mt-table accounts__table">
          <thead>
            <tr>
              <th>帳號</th>
              <th>名稱</th>
              <th>角色</th>
              <th>狀態</th>
              <th>最後登入</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in accounts ?? []" :key="item.id">
              <td>
                <strong>{{ item.username }}</strong>
                <small class="mt-muted">ID {{ item.id }}</small>
              </td>
              <td>{{ item.displayName }}</td>
              <td><span class="mt-status" :class="ROLE_TONE[item.role]">{{ roleLabel(item.role) }}</span></td>
              <td>
                <span class="mt-status" :class="item.disabled ? 'cancelled' : 'completed'">{{ item.disabled ? '已停用' : '已啟用' }}</span>
              </td>
              <td>{{ item.lastLoginAt ? dateTime(item.lastLoginAt) : '—' }}</td>
              <td class="mt-actions">
                <template v-if="item.id !== session.admin?.id">
                  <button type="button" @click="resetPassword(item)">重設密碼</button>
                  <button v-if="item.disabled" type="button" class="is-restore" @click="setDisabled(item, false)">啟用</button>
                  <button v-else type="button" class="is-danger" @click="setDisabled(item, true)">停用</button>
                </template>
                <span v-else class="mt-muted">你自己（到「修改密碼」更改）</span>
              </td>
            </tr>
            <tr v-if="accounts && accounts.length === 0">
              <td colspan="6" class="mt-empty">
                <strong>尚未建立管理員帳號</strong>
                <span>點擊右上角「新增管理員」開始設定。</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="form" class="mt-modal-backdrop" @click.self="saving || (form = null)" @keydown.esc="saving || (form = null)">
      <form class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="administrator-form-title" @submit.prevent="create">
        <div class="mt-form-heading">
          <div>
            <span class="mt-eyebrow">NEW ACCOUNT</span>
            <h3 id="administrator-form-title">新增管理員</h3>
            <p class="mt-muted">設定登入資訊及後台操作權限；密碼由系統產生，只顯示一次。</p>
          </div>
          <button type="button" class="mt-close" aria-label="關閉" :disabled="saving" @click="form = null">×</button>
        </div>
        <label class="mt-field">
          登入帳號
          <input ref="firstField" v-model.trim="form.username" placeholder="例如：ops_chan" autocomplete="off" pattern="[a-z0-9_.-]{3,40}" required />
          <small class="mt-muted">小寫英文字母、數字、點、底線或連字號，3 至 40 個字元；建立後不能更改。</small>
        </label>
        <label class="mt-field">
          顯示名稱
          <input v-model.trim="form.displayName" placeholder="例如：營運主管" maxlength="40" required />
        </label>
        <label class="mt-field">
          權限角色
          <select v-model="form.role">
            <option v-for="role in ROLES" :key="role.value" :value="role.value">{{ role.label }} — {{ role.detail }}</option>
          </select>
        </label>
        <div class="mt-form-actions">
          <button type="button" class="secondary" :disabled="saving" @click="form = null">取消</button>
          <button type="submit" class="primary" :disabled="saving">{{ saving ? '建立中…' : '建立管理員' }}</button>
        </div>
      </form>
    </div>

    <div v-if="oneTime" class="mt-modal-backdrop">
      <div class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="one-time-title">
        <div class="mt-form-heading">
          <div>
            <span class="mt-eyebrow">{{ oneTime.reset ? 'PASSWORD RESET' : 'ACCOUNT CREATED' }}</span>
            <h3 id="one-time-title">{{ oneTime.reset ? '密碼已重設' : '管理員已建立' }}</h3>
            <p class="mt-muted">「{{ oneTime.username }}」的一次性密碼只會顯示這一次。請以安全方式交給對方，並請對方登入後立即修改。</p>
          </div>
        </div>
        <label class="mt-field">
          一次性密碼
          <input class="accounts__password" :value="oneTime.password" readonly @focus="($event.target as HTMLInputElement).select()" />
        </label>
        <div class="mt-form-actions">
          <button type="button" class="secondary" @click="copyPassword">複製密碼</button>
          <button type="button" class="primary" @click="oneTime = null">我已記下</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Master Travel's administrators table: one line per account, the actions on the right. */
.accounts__table {
  min-width: 860px;
  table-layout: fixed;
}
.accounts__table th:nth-child(1) {
  width: 24%;
}
.accounts__table th:nth-child(2) {
  width: 14%;
}
.accounts__table th:nth-child(3),
.accounts__table th:nth-child(4) {
  width: 12%;
}
.accounts__table th:nth-child(5) {
  width: 15%;
}
.accounts__table th:nth-child(6) {
  width: 23%;
}
.accounts__table td small {
  white-space: normal;
}
.accounts__password {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 16px !important;
  letter-spacing: 0.04em;
}
</style>

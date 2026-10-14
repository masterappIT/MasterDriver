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
  <section class="administrator-management">
    <div class="administrator-page-heading">
      <div>
        <span class="eyebrow">ACCESS CONTROL</span>
        <h2>後台帳號</h2>
        <p class="muted">管理後台登入帳號、權限角色與啟用狀態，確保每位管理員使用獨立帳號。</p>
      </div>
      <button type="button" class="administrator-primary-action" @click="openForm">＋ 新增管理員</button>
    </div>

    <div v-if="loadError" class="notice error">
      {{ loadError }} <button class="button secondary" type="button" @click="load">重試</button>
    </div>

    <div class="mt-panel administrator-list-panel">
      <div class="administrator-list-summary">
        <div><strong>{{ accounts?.length ?? 0 }}</strong><span>個管理員帳號</span></div>
        <div><strong>{{ enabledCount }}</strong><span>個啟用中</span></div>
        <div><strong>{{ superCount }}</strong><span>位超級管理員</span></div>
      </div>
      <div class="administrator-table-wrap">
        <table>
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
                <strong class="administrator-username">{{ item.username }}</strong>
                <small class="muted">ID {{ item.id }}</small>
              </td>
              <td>{{ item.displayName }}</td>
              <td><span class="administrator-role" :class="item.role.toLowerCase()">{{ roleLabel(item.role) }}</span></td>
              <td>
                <span class="mt-status" :class="item.disabled ? 'cancelled' : 'completed'">{{ item.disabled ? '已停用' : '已啟用' }}</span>
              </td>
              <td>{{ item.lastLoginAt ? dateTime(item.lastLoginAt) : '—' }}</td>
              <td class="row-actions">
                <template v-if="item.id !== session.admin?.id">
                  <button type="button" class="administrator-edit-action" @click="resetPassword(item)">重設密碼</button>
                  <button v-if="item.disabled" type="button" class="administrator-enable-action" @click="setDisabled(item, false)">啟用</button>
                  <button v-else type="button" class="administrator-disable-action" @click="setDisabled(item, true)">停用</button>
                </template>
                <span v-else class="muted">你自己（到「修改密碼」更改）</span>
              </td>
            </tr>
            <tr v-if="accounts && accounts.length === 0">
              <td colspan="6" class="administrator-empty">
                <strong>尚未建立管理員帳號</strong>
                <span>點擊右上角「新增管理員」開始設定。</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="form" class="mt-modal-backdrop" @click.self="saving || (form = null)" @keydown.esc="saving || (form = null)">
      <form class="mt-record-form administrator-form" role="dialog" aria-modal="true" aria-labelledby="administrator-form-title" @submit.prevent="create">
        <div class="administrator-form-heading">
          <div>
            <span class="eyebrow">NEW ACCOUNT</span>
            <h3 id="administrator-form-title">新增管理員</h3>
            <p class="muted">設定登入資訊及後台操作權限；密碼由系統產生，只顯示一次。</p>
          </div>
          <button type="button" class="icon-close-btn" aria-label="關閉" :disabled="saving" @click="form = null">×</button>
        </div>
        <label>
          登入帳號
          <input ref="firstField" v-model.trim="form.username" placeholder="例如：ops_chan" autocomplete="off" pattern="[a-z0-9_.-]{3,40}" required />
          <small class="muted">小寫英文字母、數字、點、底線或連字號，3 至 40 個字元；建立後不能更改。</small>
        </label>
        <label>
          顯示名稱
          <input v-model.trim="form.displayName" placeholder="例如：營運主管" maxlength="40" required />
        </label>
        <label>
          權限角色
          <select v-model="form.role">
            <option v-for="role in ROLES" :key="role.value" :value="role.value">{{ role.label }} — {{ role.detail }}</option>
          </select>
        </label>
        <div class="administrator-form-actions">
          <button type="button" class="secondary" :disabled="saving" @click="form = null">取消</button>
          <button type="submit" class="primary" :disabled="saving">{{ saving ? '建立中…' : '建立管理員' }}</button>
        </div>
      </form>
    </div>

    <div v-if="oneTime" class="mt-modal-backdrop">
      <div class="mt-record-form administrator-form" role="dialog" aria-modal="true" aria-labelledby="one-time-title">
        <div class="administrator-form-heading">
          <div>
            <span class="eyebrow">{{ oneTime.reset ? 'PASSWORD RESET' : 'ACCOUNT CREATED' }}</span>
            <h3 id="one-time-title">{{ oneTime.reset ? '密碼已重設' : '管理員已建立' }}</h3>
            <p class="muted">「{{ oneTime.username }}」的一次性密碼只會顯示這一次。請以安全方式交給對方，並請對方登入後立即修改。</p>
          </div>
        </div>
        <label>
          一次性密碼
          <input class="administrator-password" :value="oneTime.password" readonly @focus="($event.target as HTMLInputElement).select()" />
        </label>
        <div class="administrator-form-actions">
          <button type="button" class="secondary" @click="copyPassword">複製密碼</button>
          <button type="button" class="primary" @click="oneTime = null">我已記下</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Master Travel admin/src/styles/administrators.css, tables.css and overlays.css (c902bb5a), kept to this page. */
.administrator-management {
  display: grid;
  gap: 20px;
}
.eyebrow {
  display: block;
  color: #59708e;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.16em;
}
.muted {
  color: #7c8ca1;
  font-size: 12px;
}
.administrator-page-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}
.administrator-page-heading h2 {
  margin: 6px 0 5px;
  color: #12243b;
  font-size: 28px;
  letter-spacing: -0.035em;
}
.administrator-page-heading p {
  margin: 0;
  max-width: 620px;
}
.administrator-primary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 11px 18px;
  border: 0;
  border-radius: 11px;
  color: #fff;
  background: linear-gradient(135deg, #155dcc, #2684f5);
  box-shadow: 0 7px 16px rgba(23, 105, 224, 0.22);
  font-size: 13px;
  font-weight: 750;
  white-space: nowrap;
  transition: filter 0.16s ease, transform 0.16s ease;
}
.administrator-primary-action:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}
.mt-panel {
  overflow: hidden;
  border: 1px solid #e1e8f2;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 12px 32px rgba(39, 72, 111, 0.08);
}
.administrator-list-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  border-bottom: 1px solid #e8eef6;
  background: #e8eef6;
}
.administrator-list-summary > div {
  display: grid;
  gap: 4px;
  padding: 18px 24px;
  background: #fbfcfe;
}
.administrator-list-summary strong {
  color: #1769e0;
  font-size: 26px;
  letter-spacing: -0.04em;
}
.administrator-list-summary span {
  color: #71849d;
  font-size: 12px;
  font-weight: 700;
}
.administrator-table-wrap {
  min-width: 0;
  overflow-x: auto;
}
.administrator-table-wrap table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
  table-layout: fixed;
  text-align: left;
  font-size: 14px;
}
.administrator-table-wrap th,
.administrator-table-wrap td {
  padding: 19px 24px;
  border-bottom: 1px solid #e8eef6;
  vertical-align: middle;
}
.administrator-table-wrap th {
  color: #667a94;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
}
.administrator-table-wrap tbody tr:last-child td {
  border-bottom: 0;
}
.administrator-table-wrap th:nth-child(1) {
  width: 22%;
}
.administrator-table-wrap th:nth-child(2) {
  width: 14%;
}
.administrator-table-wrap th:nth-child(3),
.administrator-table-wrap th:nth-child(4) {
  width: 12%;
}
.administrator-table-wrap th:nth-child(5) {
  width: 16%;
}
.administrator-table-wrap th:nth-child(6) {
  width: 24%;
}
.administrator-username {
  display: block;
  color: #12243b;
}
.administrator-table-wrap td small {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  overflow-wrap: anywhere;
}
.administrator-role {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  color: #425974;
  background: #edf2f8;
  font-size: 11px;
  font-weight: 750;
  white-space: nowrap;
}
.administrator-role.super_admin {
  color: #7444a8;
  background: #f1e8ff;
}
.administrator-role.operator {
  color: #1769e0;
  background: #e5f0ff;
}
.administrator-role.sales {
  color: #63758d;
  background: #eef2f6;
}
.mt-status {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 750;
}
.mt-status.completed {
  color: #137044;
  background: #def6e9;
}
.mt-status.cancelled {
  color: #a52b2b;
  background: #ffe4e4;
}
.row-actions {
  white-space: nowrap;
}
.row-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  margin-right: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 750;
  transition: background-color 0.16s ease, color 0.16s ease;
}
.administrator-edit-action {
  color: #1769e0;
  background: #f7fbff;
}
.administrator-edit-action:hover {
  color: #fff;
  background: #1769e0;
}
.administrator-enable-action {
  color: #217346;
  background: #f4fbf6;
}
.administrator-enable-action:hover {
  color: #fff;
  background: #217346;
}
.administrator-disable-action {
  color: #c2414a;
  background: #fff8f8;
}
.administrator-disable-action:hover {
  color: #fff;
  background: #c2414a;
}
.administrator-empty {
  padding: 48px 24px !important;
  text-align: center;
}
.administrator-empty strong,
.administrator-empty span {
  display: block;
}
.administrator-empty span {
  margin-top: 7px;
  color: #8293a9;
  font-size: 12px;
}
.mt-modal-backdrop {
  position: fixed;
  z-index: 50;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(18, 36, 59, 0.48);
  backdrop-filter: blur(5px);
  animation: modal-fade-in 0.18s ease-out;
}
.mt-record-form {
  display: grid;
  gap: 14px;
  width: min(540px, 100%);
  margin: 0;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(18, 36, 59, 0.24);
  animation: modal-slide-in 0.2s ease-out;
}
.administrator-form-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 2px;
}
.administrator-form-heading h3 {
  margin: 5px 0 4px;
  color: #12243b;
  font-size: 22px;
  letter-spacing: -0.025em;
}
.administrator-form-heading p {
  margin: 0;
  line-height: 1.6;
}
.icon-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-width: 44px;
  height: 44px;
  border: 0;
  border-radius: 10px;
  color: #647892;
  background: transparent;
  font-size: 24px;
  line-height: 1;
}
.icon-close-btn:hover {
  background: #f1f5fa;
}
.administrator-form > label {
  display: grid;
  gap: 7px;
  color: #526985;
  font-size: 12px;
  font-weight: 750;
}
.administrator-form > label > input,
.administrator-form > label > select {
  width: 100%;
  height: 46px;
  padding: 10px 12px;
  border: 1px solid #ccd8e7;
  border-radius: 10px;
  outline: 0;
  color: #29415f;
  background: #f8fafd;
  font-size: 14px;
  font-weight: 400;
}
.administrator-form > label > input:focus,
.administrator-form > label > select:focus {
  border-color: #4a8df0;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(74, 141, 240, 0.13);
}
.administrator-form > label > small {
  margin-top: -2px;
  font-weight: 500;
}
.administrator-password {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 16px !important;
  letter-spacing: 0.04em;
}
.administrator-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
  padding-top: 16px;
  border-top: 1px solid #edf1f6;
}
.administrator-form-actions button {
  min-width: 132px;
  height: 44px;
  padding: 0 22px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 750;
  line-height: 1;
}
.administrator-form-actions .primary {
  border: 0;
  color: #fff;
  background: linear-gradient(135deg, #1769e0, #3f8df0);
  box-shadow: 0 6px 14px rgba(23, 105, 224, 0.16);
}
.administrator-form-actions .primary:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
}
.administrator-form-actions .secondary {
  border: 1px solid #cfdae8;
  color: #425974;
  background: #f4f7fb;
}
.administrator-form-actions .secondary:hover:not(:disabled) {
  border-color: #9bbce8;
  color: #1769e0;
  background: #f5f9ff;
}
.administrator-form-actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
@keyframes modal-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes modal-slide-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (max-width: 700px) {
  .administrator-page-heading {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
  }
  .administrator-primary-action {
    width: 100%;
  }
  .administrator-list-summary {
    grid-template-columns: 1fr;
  }
  .administrator-list-summary > div {
    padding: 13px 18px;
  }
  .mt-record-form {
    padding: 22px;
  }
  .administrator-form-actions button {
    flex: 1;
    min-width: 0;
  }
}
</style>

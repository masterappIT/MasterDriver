<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api, ROLE_LABEL, session, type AdminRole } from '../api';
import { dateTime } from '../format';

interface Account {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  disabled: boolean;
  lastLoginAt: string | null;
}

const accounts = ref<Account[]>([]);
const form = reactive({ username: '', displayName: '', role: 'OPERATOR' as AdminRole });
const error = ref('');
/** A one-time password is shown here once and never again. */
const oneTime = ref<{ username: string; password: string } | null>(null);

async function run(action: () => Promise<void>) {
  error.value = '';
  try {
    await action();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const load = () => run(async () => void (accounts.value = await api<Account[]>('GET', '/accounts')));

const create = () =>
  run(async () => {
    const result = await api<{ admin: Account; password: string }>('POST', '/accounts', { ...form });
    oneTime.value = { username: result.admin.username, password: result.password };
    form.username = '';
    form.displayName = '';
    await load();
  });

const resetPassword = (account: Account) =>
  run(async () => {
    if (!confirm(`重設「${account.displayName}」的密碼？對方會被登出。`)) return;
    const { password } = await api<{ password: string }>('POST', `/accounts/${account.id}/reset-password`);
    oneTime.value = { username: account.username, password };
  });

const setDisabled = (account: Account, disabled: boolean) =>
  run(async () => {
    accounts.value = await api<Account[]>('POST', `/accounts/${account.id}/${disabled ? 'disable' : 'enable'}`);
  });

onMounted(load);
</script>

<template>
  <h1>後台帳號</h1>
  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="oneTime" class="notice warning">
    「{{ oneTime.username }}」的一次性密碼：<strong>{{ oneTime.password }}</strong><br />
    只會顯示這一次，請以安全方式交給對方，並請對方登入後立即修改。
    <button class="button secondary" @click="oneTime = null">我已記下</button>
  </div>

  <div class="card">
    <h2>新增帳號</h2>
    <form class="row" @submit.prevent="create">
      <input v-model="form.username" class="input" placeholder="帳號（小寫英數，3–40 字）" required />
      <input v-model="form.displayName" class="input" placeholder="顯示名稱" required />
      <select v-model="form.role" class="select">
        <option v-for="(label, role) in ROLE_LABEL" :key="role" :value="role">{{ label }}</option>
      </select>
      <button class="button" type="submit">新增</button>
    </form>
    <p class="hint">營運：可改收費控制、充值與贈送；銷售：只能查看，看不到乘客資料；超級管理員：全部，含帳號與開發模式登入。</p>
  </div>

  <div class="card table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th>帳號</th>
          <th>名稱</th>
          <th>角色</th>
          <th>最後登入</th>
          <th>狀態</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="account in accounts" :key="account.id">
          <td>{{ account.username }}</td>
          <td>{{ account.displayName }}</td>
          <td>{{ ROLE_LABEL[account.role] }}</td>
          <td class="nowrap">{{ dateTime(account.lastLoginAt) }}</td>
          <td><span class="tag" :class="account.disabled ? 'tag--danger' : 'tag--info'">{{ account.disabled ? '已停用' : '使用中' }}</span></td>
          <td class="row">
            <template v-if="account.id !== session.admin?.id">
              <button class="button secondary" @click="resetPassword(account)">重設密碼</button>
              <button v-if="account.disabled" class="button secondary" @click="setDisabled(account, false)">啟用</button>
              <button v-else class="button danger" @click="setDisabled(account, true)">停用</button>
            </template>
            <span v-else class="hint">你自己</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
/**
 * 驗證碼等待時間: how long drivers waited from asking for an SMS code to signing in, per number
 * area, over the last week. Includes typing the code, so it is an upper bound on how long the
 * SMS took. Styled by the page's login-settings.css.
 */

export interface RouteWait {
  route: 'DOMESTIC' | 'INTERNATIONAL';
  attempts: number;
  signedIn: number;
  notSignedIn: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
  slowestSeconds: number | null;
}

defineProps<{ days: number; routes: RouteWait[] }>();

const AREA: Record<RouteWait['route'], string> = { DOMESTIC: '+86 內地', INTERNATIONAL: '+852 香港、+853 澳門' };

function duration(seconds: number | null) {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}
</script>

<template>
  <div class="sms-history">
    <div class="sms-history-header">
      <h4>驗證碼等待時間（最近 {{ days }} 天）</h4>
    </div>
    <div class="history-table">
      <table>
        <thead>
          <tr><th>號碼區</th><th>申請登入</th><th>已登入</th><th>申請後沒登入</th><th>一般等待（中位數）</th><th>最慢一成</th><th>最慢</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in routes" :key="item.route">
            <td>{{ AREA[item.route] }}</td>
            <td>{{ item.attempts }}</td>
            <td>{{ item.signedIn }}</td>
            <td>{{ item.notSignedIn }}</td>
            <td>{{ duration(item.medianSeconds) }}</td>
            <td>{{ duration(item.p90Seconds) }}</td>
            <td>{{ duration(item.slowestSeconds) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="wechat-secret-help">
      從司機第一次申請驗證碼算到登入成功，含輸入驗證碼的時間，所以比簡訊實際送達略長。同一次登入中按「重新發送」只算一次。開發模式登入不計。
    </p>
  </div>
</template>

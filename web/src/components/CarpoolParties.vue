<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { partyRoute } from '../carpool';
import { loadLine, money, shortTime, type Money } from '../format';
import { t } from '../i18n';
import ContactLines from './ContactLines.vue';

/** 拼車: one party on a carpool order, as the API gives it to this viewer. */
export interface CarpoolParty {
  id?: string;
  passengers: number;
  luggage: number;
  pickupPoint: string;
  dropoff: string;
  passengerName?: string;
  passengerContact?: string | null;
  passengerWechat?: string | null;
  notes?: string | null;
  arrivedAt?: string | null;
  pickedUpAt?: string | null;
  noShowAt?: string | null;
  droppedAt?: string | null;
  noShowFrom?: string | null;
  price?: Money;
  paidAt?: string | null;
}

export interface CarpoolOnOrder {
  id?: string;
  partyCount: number;
  stops: string[];
  waitMinutes: number;
  parties: CarpoolParty[];
}

/**
 * The parties of a carpool order. Before claiming, a driver sees only where each gets on and off
 * and how many they are. The one who drives reports each party (到了、上車、沒出現、下車); the
 * dispatcher marks each party's fare received.
 */
defineProps<{ carpool: CarpoolOnOrder; destination: string; drives?: boolean; dispatcher?: boolean; busy?: boolean }>();
const emit = defineEmits<{ progress: [id: string, step: 'ARRIVED' | 'PICKED_UP' | 'NO_SHOW' | 'DROPPED_OFF', label: string]; paid: [id: string, paid: boolean] }>();

/** The clock moves the 乘客沒出現 button from waiting to ready without a reload. */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
onMounted(() => (ticker = setInterval(() => (now.value = Date.now()), 15_000)));
onBeforeUnmount(() => clearInterval(ticker));

const time = (iso: string) => shortTime(iso).split(' ')[1] ?? '';

function stateOf(party: CarpoolParty) {
  if (party.droppedAt) return `${time(party.droppedAt)} 已下車`;
  if (party.pickedUpAt) return `${time(party.pickedUpAt)} 已上車`;
  if (party.noShowAt) return `${time(party.noShowAt)} 標記沒出現`;
  if (party.arrivedAt) return `${time(party.arrivedAt)} 已到上車點`;
  return '';
}

function noShowReady(party: CarpoolParty) {
  return Boolean(party.noShowFrom && new Date(party.noShowFrom).getTime() <= now.value);
}

</script>

<template>
  <div class="parties">
    <p class="parties__summary">{{ t(`拼車：${carpool.partyCount} 組乘客`) }}<template v-if="carpool.stops.length">{{ t(`，上車點 ${carpool.stops.join('、')}`) }}</template></p>
    <article v-for="(party, index) in carpool.parties" :key="party.id ?? index" class="parties__party">
      <div class="parties__top">
        <strong>{{ party.passengerName ? t(party.passengerName) : t(`第 ${index + 1} 組`) }}</strong>
        <span class="parties__load">{{ t(loadLine(party.passengers, party.luggage)) }}</span>
      </div>
      <p class="parties__line">{{ t(partyRoute(party, destination)) }}</p>
      <p v-if="party.notes" class="parties__note">{{ t(party.notes) }}</p>
      <p v-if="stateOf(party)" class="parties__state">{{ t(stateOf(party)) }}</p>
      <ContactLines v-if="party.passengerContact" :phones="[party.passengerContact]" :wechat-id="party.passengerWechat" />

      <div v-if="drives && party.id && !party.droppedAt && !party.noShowAt" class="parties__actions">
        <button v-if="!party.arrivedAt" class="button" type="button" :disabled="busy" @click="emit('progress', party.id, 'ARRIVED', '已到上車點')">{{ t('已到上車點') }}</button>
        <template v-else-if="!party.pickedUpAt">
          <button class="button" type="button" :disabled="busy" @click="emit('progress', party.id, 'PICKED_UP', '已上車')">{{ t('已上車') }}</button>
          <button class="button secondary" type="button" :disabled="busy || !noShowReady(party)" @click="emit('progress', party.id, 'NO_SHOW', '乘客沒出現')">
            {{ noShowReady(party) ? t('乘客沒出現') : t(`${time(party.noShowFrom ?? '')} 後可按沒出現`) }}
          </button>
        </template>
        <button v-else class="button secondary" type="button" :disabled="busy" @click="emit('progress', party.id, 'DROPPED_OFF', '已下車')">{{ t('已下車') }}</button>
      </div>

      <div v-if="dispatcher && party.id" class="parties__money">
        <span>{{ party.price ? t(money(party.price)) : t('每位價錢未填') }}</span>
        <button class="chip" type="button" :disabled="busy" @click="emit('paid', party.id, !party.paidAt)">
          {{ party.paidAt ? t('已收款（按一下改回）') : t('標記已收款') }}
        </button>
      </div>
    </article>
    <p v-if="drives" class="hint">{{ t(`到了每組的上車點各按一次；等了 ${carpool.waitMinutes} 分鐘還沒見到人，可以按「乘客沒出現」。`) }}</p>
  </div>
</template>

<style scoped>
.parties__summary {
  margin: 0 0 var(--space-sm);
  font-weight: 700;
}
.parties__party {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-md) 0;
  border-top: 1px solid var(--color-divider);
}
.parties__top {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
}
.parties__load {
  color: var(--color-text-secondary);
  white-space: nowrap;
}
.parties__line {
  margin: 0;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}
.parties__note {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-input);
  background: var(--color-gold-tint);
  color: var(--color-gold-ink);
  white-space: pre-wrap;
}
.parties__state {
  margin: 0;
  color: var(--color-primary-dark);
  font-weight: 700;
}
.parties__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}
.parties__actions .button:only-child {
  grid-column: 1 / -1;
}
.parties__money {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}
</style>

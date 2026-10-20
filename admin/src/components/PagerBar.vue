<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ page: number; pageSize: number; total: number }>();
const emit = defineEmits<{ change: [page: number] }>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>

<!-- How many there are is beside the page's title; under the list only the pages, and only when there is more than one. -->
<template>
  <div v-if="pages > 1" class="pager-bar">
    <span class="pager-bar__where">第 {{ page }} / {{ pages }} 頁・每頁 {{ pageSize }} 筆</span>
    <button type="button" :disabled="page <= 1" @click="emit('change', page - 1)">上一頁</button>
    <button type="button" :disabled="page >= pages" @click="emit('change', page + 1)">下一頁</button>
  </div>
</template>

<style scoped>
/* Under a list: which page this is on the left, the buttons on the right. */
.pager-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
  margin: 0 !important;
  padding: 8px 20px;
  border-top: 1px solid var(--color-divider);
  color: var(--color-text);
  font-size: var(--font-label);
  font-weight: 600;
}

.pager-bar__where {
  margin-right: auto;
  color: var(--color-text-secondary);
  font-weight: 400;
}

.pager-bar button {
  min-width: 88px;
  padding: 9px 14px;
  border: 1px solid #cfdae8;
  border-radius: 9px;
  color: #29415f;
  background: var(--color-surface);
  font-size: var(--font-label);
  font-weight: 700;
}

.pager-bar button:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: #f5f9ff;
}

.pager-bar button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 560px) {
  .pager-bar {
    gap: 8px;
    padding-right: 16px;
    padding-left: 16px;
  }

  .pager-bar__where {
    flex: 1 0 100%;
    text-align: center;
  }

  .pager-bar button {
    min-width: 78px;
  }
}
</style>

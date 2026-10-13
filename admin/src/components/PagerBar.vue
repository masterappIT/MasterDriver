<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ page: number; pageSize: number; total: number }>();
const emit = defineEmits<{ change: [page: number] }>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>

<template>
  <div class="row pager-bar">
    <span class="muted">共 {{ total }} 筆</span>
    <button class="button secondary" :disabled="page <= 1" @click="emit('change', page - 1)">上一頁</button>
    <span>{{ page }} / {{ pages }}</span>
    <button class="button secondary" :disabled="page >= pages" @click="emit('change', page + 1)">下一頁</button>
  </div>
</template>

<style scoped>
.pager-bar {
  justify-content: flex-end;
  margin-top: var(--space-lg);
}
</style>

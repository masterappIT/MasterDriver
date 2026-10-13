<script setup lang="ts">
/** Hong Kong plates gold, Macau and mainland plates black, as the real plates are. */
defineProps<{ hk?: string | null; macau?: string | null; mainland?: string | null }>();
</script>

<template>
  <span class="plate-tag">
    <span v-if="hk" class="plate-tag__plate plate-tag__plate--hk">{{ hk }}</span>
    <span v-if="macau" class="plate-tag__plate plate-tag__plate--black">{{ macau }}</span>
    <span v-if="mainland" class="plate-tag__plate plate-tag__plate--black">{{ mainland }}</span>
  </span>
</template>

<style scoped>
.plate-tag {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.plate-tag__plate {
  border-radius: 5px;
  padding: 1px var(--space-sm);
  font-weight: 800;
  letter-spacing: 0.5px;
  text-align: center;
  white-space: nowrap;
}
.plate-tag__plate--hk {
  background: var(--plate-gold);
  color: #171717;
}
.plate-tag__plate--black {
  background: var(--plate-black);
  color: var(--color-on-primary);
}
</style>

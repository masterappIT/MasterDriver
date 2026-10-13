<script setup lang="ts">
import { onMounted } from 'vue';
import { loadSite, site } from '../site';

/** The platform's logo from the admin (一般設定), or the name in text until one is uploaded. */
onMounted(loadSite);
</script>

<template>
  <img v-if="site.settings?.logoUrl" class="brand-mark" :src="site.settings.logoUrl" alt="MasterDriver" />
  <strong v-else class="brand-mark brand-mark--text">MasterDriver</strong>
</template>

<style scoped>
.brand-mark {
  display: block;
  height: 32px;
  max-width: 200px;
  object-fit: contain;
  object-position: left center;
}
.brand-mark--text {
  height: auto;
  font-size: var(--font-body-large);
}
</style>

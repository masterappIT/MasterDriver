<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { answer, dialog, dismiss, toasts } from '../feedback';

const field = ref<HTMLTextAreaElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);

watch(
  () => dialog.open,
  (open) => {
    if (open) void nextTick(() => (open.reason ? field.value : confirmButton.value)?.focus());
  },
);

const canConfirm = () => !dialog.open?.reason || dialog.open.reasonOptional || dialog.reason.trim().length > 0;

function confirm() {
  if (canConfirm()) answer(dialog.reason.trim());
}
</script>

<template>
  <div v-if="dialog.open" class="feedback__backdrop" @click.self="answer(null)" @keydown.esc="answer(null)">
    <form class="card feedback__dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" @submit.prevent="confirm">
      <h2 id="feedback-title">{{ dialog.open.title }}</h2>
      <p class="feedback__text">{{ dialog.open.text }}</p>
      <label v-if="dialog.open.reason" class="field">
        {{ dialog.open.reason }}{{ dialog.open.reasonOptional ? '（選填）' : '' }}
        <textarea ref="field" v-model="dialog.reason" class="input" rows="3" maxlength="500" />
      </label>
      <div class="feedback__actions">
        <button class="button secondary" type="button" @click="answer(null)">取消</button>
        <button ref="confirmButton" class="button" :class="{ danger: dialog.open.danger }" type="submit" :disabled="!canConfirm()">
          {{ dialog.open.confirm }}
        </button>
      </div>
    </form>
  </div>
  <div class="feedback__toasts" aria-live="polite">
    <div v-for="toast in toasts" :key="toast.id" class="feedback__toast" :class="{ 'feedback__toast--error': toast.error }" :role="toast.error ? 'alert' : 'status'">
      <span>{{ toast.text }}</span>
      <button type="button" aria-label="關閉" @click="dismiss(toast.id)">關閉</button>
    </div>
  </div>
</template>

<style scoped>
/* Master Travel admin/src/styles/overlays.css (c902bb5a): the confirm dialog and the toasts. */
.feedback__backdrop {
  position: fixed;
  z-index: 60;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(18, 36, 59, 0.48);
  backdrop-filter: blur(5px);
  overscroll-behavior: contain;
  animation: feedback-fade-in 0.18s ease-out;
}

.feedback__dialog {
  display: grid;
  gap: 14px;
  width: min(460px, 100%);
  margin: 0;
  padding: 28px;
  border: 1px solid #e1e8f2;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(18, 36, 59, 0.24);
  animation: feedback-slide-in 0.2s ease-out;
}

.feedback__dialog h2 {
  margin: 0;
  color: #12243b;
  font-size: 21px;
  letter-spacing: -0.02em;
}

.feedback__text {
  margin: 0;
  color: #647892;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-line;
}

.feedback__dialog .field textarea {
  border-radius: 10px;
}

.feedback__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
  padding-top: 18px;
  border-top: 1px solid #edf1f6;
}

.feedback__actions .button {
  min-width: 96px;
  height: 42px;
  border-radius: 10px;
}

.feedback__actions .button.danger {
  background: #c24141;
  box-shadow: 0 5px 12px rgba(194, 65, 65, 0.2);
}

.feedback__toasts {
  position: fixed;
  z-index: 1000;
  right: 20px;
  bottom: 20px;
  display: grid;
  gap: 10px;
  width: min(360px, calc(100vw - 32px));
}

.feedback__toast {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  color: #fff;
  background: #15803d;
  box-shadow: 0 10px 30px rgb(15 23 42 / 18%);
  font-size: 14px;
}

.feedback__toast--error {
  background: #b91c1c;
}

.feedback__toast button {
  flex-shrink: 0;
  padding: 0;
  border: 0;
  color: rgb(255 255 255 / 80%);
  background: none;
  font-size: var(--font-caption);
}

@keyframes feedback-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes feedback-slide-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 480px) {
  .feedback__dialog {
    padding: 22px;
  }

  .feedback__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>

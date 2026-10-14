<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../i18n';
import BottomSheet from './BottomSheet.vue';

/**
 * A picked photo, placed by the driver inside the 4:3 frame every vehicle photo is shown in:
 * dragged into position and made larger with two fingers or the slider. What is inside the
 * frame is what gets uploaded, so the passenger sees the same picture.
 */
const props = defineProps<{ file: File }>();
const emit = defineEmits<{ done: [image: Blob]; cancel: []; failed: [] }>();

const MAX_ZOOM = 4;
const OUTPUT_WIDTH = 1600;

const frame = ref<HTMLDivElement | null>(null);
const picture = ref<HTMLImageElement | null>(null);
const source = URL.createObjectURL(props.file);
const ready = ref(false);
const busy = ref(false);
const zoom = ref(1);
const x = ref(0);
const y = ref(0);
/** The frame and the photo, in CSS pixels and in the photo's own pixels. */
const size = { frameWidth: 0, frameHeight: 0, width: 0, height: 0, cover: 1 };

const scale = () => size.cover * zoom.value;
const placed = computed(() => (ready.value ? { transform: `translate(${x.value}px, ${y.value}px) scale(${size.cover * zoom.value})` } : {}));

/** The photo always fills the frame: no edge may come inside it. */
function clamp() {
  x.value = Math.min(0, Math.max(size.frameWidth - size.width * scale(), x.value));
  y.value = Math.min(0, Math.max(size.frameHeight - size.height * scale(), y.value));
}

function loaded() {
  const box = frame.value;
  const img = picture.value;
  if (!box || !img || !img.naturalWidth) return emit('failed');
  size.frameWidth = box.clientWidth;
  size.frameHeight = box.clientHeight;
  size.width = img.naturalWidth;
  size.height = img.naturalHeight;
  size.cover = Math.max(size.frameWidth / size.width, size.frameHeight / size.height);
  x.value = (size.frameWidth - size.width * size.cover) / 2;
  y.value = (size.frameHeight - size.height * size.cover) / 2;
  ready.value = true;
}

/** Zooming keeps the point at (originX, originY) of the frame where it is. */
function zoomTo(next: number, originX = size.frameWidth / 2, originY = size.frameHeight / 2) {
  const before = scale();
  zoom.value = Math.min(MAX_ZOOM, Math.max(1, next));
  const ratio = scale() / before;
  x.value = originX - (originX - x.value) * ratio;
  y.value = originY - (originY - y.value) * ratio;
  clamp();
}

const touches = new Map<number, { x: number; y: number }>();
const spread = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

function down(event: PointerEvent) {
  if (!ready.value) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
}

function move(event: PointerEvent) {
  const last = touches.get(event.pointerId);
  if (!last) return;
  if (touches.size === 1) {
    x.value += event.clientX - last.x;
    y.value += event.clientY - last.y;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    clamp();
    return;
  }
  const before = spread();
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const box = frame.value?.getBoundingClientRect();
  const [a, b] = [...touches.values()];
  if (before > 0 && box) zoomTo(zoom.value * (spread() / before), (a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top);
}

function up(event: PointerEvent) {
  touches.delete(event.pointerId);
}

async function use() {
  const img = picture.value;
  if (!img || !ready.value) return;
  busy.value = true;
  try {
    const current = scale();
    const cut = { x: -x.value / current, y: -y.value / current, width: size.frameWidth / current, height: size.frameHeight / current };
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(Math.min(OUTPUT_WIDTH, cut.width));
    canvas.height = Math.round((canvas.width * 3) / 4);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, cut.x, cut.y, cut.width, cut.height, 0, 0, canvas.width, canvas.height);
    // Re-encoding as JPEG also drops the location a phone camera writes into the file.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('canvas');
    emit('done', blob);
  } catch {
    emit('failed');
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (picture.value?.complete) loaded();
});
onBeforeUnmount(() => URL.revokeObjectURL(source));
</script>

<template>
  <BottomSheet :title="t('調整照片')" @close="emit('cancel')">
    <p class="hint photo-crop__hint">{{ t('拖動照片調整位置，用兩指或下面的滑桿放大。框內就是乘客看到的樣子。') }}</p>
    <div
      ref="frame"
      class="photo-crop__frame"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <img ref="picture" :src="source" :style="placed" :alt="t('車輛照片')" draggable="false" @load="loaded" @error="emit('failed')" />
    </div>
    <label class="photo-crop__zoom">
      <span>{{ t('放大') }}</span>
      <input type="range" min="1" :max="MAX_ZOOM" step="0.01" :value="zoom" :disabled="!ready" @input="zoomTo(Number(($event.target as HTMLInputElement).value))" />
    </label>
    <div class="photo-crop__actions">
      <button class="button secondary" type="button" :disabled="busy" @click="emit('cancel')">{{ t('取消') }}</button>
      <button class="button" type="button" :disabled="busy || !ready" @click="use">{{ busy ? t('處理中…') : t('使用這張照片') }}</button>
    </div>
  </BottomSheet>
</template>

<style scoped>
.photo-crop__hint {
  margin: var(--space-sm) 0 var(--space-md);
}
.photo-crop__frame {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--radius-input);
  background: var(--color-divider);
  cursor: grab;
  /* The page must not scroll or zoom while the photo is being moved. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.photo-crop__frame img {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  transform-origin: 0 0;
  pointer-events: none;
  -webkit-touch-callout: none;
}
.photo-crop__zoom {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin: var(--space-md) 0;
  color: var(--color-text-secondary);
  font-size: var(--font-label);
}
.photo-crop__zoom input {
  flex: 1;
  min-height: 44px;
}
.photo-crop__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}
</style>

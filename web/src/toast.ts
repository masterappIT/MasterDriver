import { reactive } from 'vue';
import { t } from './i18n';

export const toastState = reactive({ text: '', visible: false });
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string) {
  toastState.text = t(text);
  toastState.visible = true;
  clearTimeout(timer);
  timer = setTimeout(() => (toastState.visible = false), 2200);
}

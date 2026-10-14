import { computed, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * A list page's search, filters and page, kept in the address: 返回 from a detail page, a reload or a
 * shared link finds the list as it was. Values equal to their default stay out of the address.
 */
export function useListQuery<T extends Record<string, string>>(defaults: T, load: (query: T & { page: number }) => void) {
  const route = useRoute();
  const router = useRouter();
  const keys = Object.keys(defaults) as (keyof T & string)[];
  const path = route.path;

  const fromAddress = () => {
    const values = { ...defaults };
    for (const key of keys) {
      const value = route.query[key];
      if (typeof value === 'string') (values as Record<string, string>)[key] = value;
    }
    return values;
  };

  /** What the filter fields show; a search box edits it before it is applied. */
  const filters = reactive({ ...fromAddress() }) as T;
  const page = computed(() => Math.max(1, Math.floor(Number(route.query.page)) || 1));
  /** Something other than the defaults is applied. */
  const filtered = computed(() => keys.some((key) => fromAddress()[key] !== defaults[key]));

  function write(values: T, toPage: number) {
    const query: Record<string, string> = {};
    for (const key of keys) if (values[key] && values[key] !== defaults[key]) query[key] = values[key];
    if (toPage > 1) query.page = String(toPage);
    void router.replace({ query });
  }

  /** Applies what the fields show, from the first page. */
  function apply(changes: Partial<T> = {}) {
    Object.assign(filters, changes);
    write({ ...filters }, 1);
  }

  function goTo(toPage: number) {
    write(fromAddress(), toPage);
  }

  function clear() {
    Object.assign(filters, defaults);
    write({ ...defaults }, 1);
  }

  // The address is the source: loads on open, on every change, and on the browser's back and forward.
  watch(
    () => route.fullPath,
    () => {
      // Leaving for a detail page changes the address too; that is not this list's business.
      if (route.path !== path) return;
      Object.assign(filters, fromAddress());
      load({ ...fromAddress(), page: page.value });
    },
    { immediate: true },
  );

  return { filters, page, filtered, apply, goTo, clear };
}

/**
 * Rows that open their detail page when clicked anywhere; links and buttons inside keep their own
 * click, ⌘ or Ctrl opens a new tab, and selecting text to copy it is not a click.
 */
export function useRowLink() {
  const router = useRouter();
  return (to: string) => (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('a, button, input, select, textarea, label')) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) window.open(router.resolve(to).href, '_blank', 'noopener');
    else void router.push(to);
  };
}

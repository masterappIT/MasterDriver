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
    // Other things in the address (an open drawer) stay as they are.
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(route.query)) if (!keys.includes(key) && key !== 'page' && typeof value === 'string') query[key] = value;
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

  // The address is the source: loads on open, on every change of the list's own part, and on the
  // browser's back and forward. Leaving for another page, or opening a drawer, is not this list's business.
  const listPart = () => (route.path === path ? JSON.stringify([fromAddress(), page.value]) : null);
  watch(
    listPart,
    (part) => {
      if (part === null) return;
      Object.assign(filters, fromAddress());
      load({ ...fromAddress(), page: page.value });
    },
    { immediate: true },
  );

  /** Loads the same list again, after something in it changed. */
  function reload() {
    load({ ...fromAddress(), page: page.value });
  }

  return { filters, page, filtered, apply, goTo, clear, reload };
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

/**
 * The detail drawer over a list, kept in the address as ?open=<id>: a link from elsewhere opens it,
 * the browser's back closes it, and a reload keeps it open.
 */
export function useDrawer() {
  const route = useRoute();
  const router = useRouter();
  const openId = computed(() => (typeof route.query.open === 'string' ? route.query.open : ''));

  function open(id: string) {
    if (id === openId.value) return;
    const query = { ...route.query, open: id };
    // From one drawer to the next replaces, so back still closes the drawer rather than stepping through them.
    void (openId.value ? router.replace({ query }) : router.push({ query }));
  }

  function close() {
    const { open: _open, ...query } = route.query;
    const without = router.resolve({ query }).fullPath;
    // Opened from this list: back. Opened from a link elsewhere: stay here and drop the drawer.
    if ((window.history.state as { back?: string | null } | null)?.back === without) router.back();
    else void router.replace({ query });
  }

  return { openId, open, close };
}

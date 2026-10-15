import { onBeforeUnmount, onMounted } from 'vue';
import { api } from './api';

interface PageSeo {
  title: string;
  description: string;
  keywords: string;
  shareImageUrl: string | null;
  robots: string;
}

function meta(attribute: 'name' | 'property', key: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  return element;
}

/**
 * Applies the title, description and share image set in the platform admin
 * (SEO → 首頁) while the public home page is shown, and puts the document back
 * the way index.html has it (not indexed) when leaving for an app page.
 *
 * These tags are set in the browser. A crawler that does not run scripts, and
 * Google when it meets the "noindex" of index.html, still sees index.html.
 */
export function usePageSeo(page: 'HOME', fallback: { title: string; description: string }) {
  const original = { title: document.title, robots: meta('name', 'robots').content };
  /** Tags this page set: those it made are removed on leaving, those index.html had get their text back. */
  const touched: { element: HTMLMetaElement; before: string | null }[] = [];

  onMounted(async () => {
    const seo = await api<PageSeo>('GET', `/public/seo/${page}`).catch(() => null);
    const title = seo?.title || fallback.title;
    const description = seo?.description || fallback.description;
    document.title = title;
    meta('name', 'robots').content = seo?.robots ?? original.robots;
    const set = (attribute: 'name' | 'property', key: string, content: string) => {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      const element = meta(attribute, key);
      touched.push({ element, before: existing ? existing.content : null });
      element.content = content;
    };
    set('name', 'description', description);
    if (seo?.keywords) set('name', 'keywords', seo.keywords);
    set('property', 'og:title', title);
    set('property', 'og:description', description);
    if (seo?.shareImageUrl) set('property', 'og:image', seo.shareImageUrl);
  });

  onBeforeUnmount(() => {
    document.title = original.title;
    meta('name', 'robots').content = original.robots;
    for (const { element, before } of touched) {
      if (before === null) element.remove();
      else element.content = before;
    }
  });
}

import { useEffect } from 'react';

type PageMeta = {
  lang: string;
  title: string;
  description?: string;
  referrerPolicy?: string;
};

function upsertMeta(attr: 'name' | 'property', key: string, content: string): HTMLMetaElement {
  let tag = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.append(tag);
  }
  tag.content = content;
  return tag;
}

export function usePageMeta({ lang, title, description, referrerPolicy }: PageMeta) {
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = title;
    upsertMeta('property', 'og:title', title);

    if (description) {
      upsertMeta('name', 'description', description);
      upsertMeta('property', 'og:description', description);
    }

    if (referrerPolicy) {
      const tag = upsertMeta('name', 'referrer', referrerPolicy);
      return () => {
        tag.remove();
      };
    }
  }, [lang, title, description, referrerPolicy]);
}

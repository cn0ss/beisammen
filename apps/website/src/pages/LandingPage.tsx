import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { dict, LANG_STORAGE_KEY, type Locale } from '@/i18n/ui';
import { usePageMeta } from '@/lib/meta';
import { Hero } from '@/sections/Hero';
import { Manifesto } from '@/sections/Manifesto';
import { Moments } from '@/sections/Moments';
import { Promises } from '@/sections/Promises';
import { Waitlist } from '@/sections/Waitlist';

export function LandingPage({ locale }: { locale: Locale }) {
  const t = dict[locale];
  const navigate = useNavigate();

  usePageMeta({ lang: t.htmlLang, title: t.meta.title, description: t.meta.description });

  // The German page owns `/`. Honor a remembered language choice, then the
  // browser language, for first-time visitors landing on the root.
  useEffect(() => {
    if (locale !== 'de') {
      return;
    }
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LANG_STORAGE_KEY);
    } catch {
      stored = null;
    }
    // Keep the search and hash so shared anchor links like /#access still
    // land on the waitlist after the locale redirect.
    const toEnglish = () =>
      navigate(
        { pathname: '/en/', search: window.location.search, hash: window.location.hash },
        { replace: true },
      );
    if (stored === 'en') {
      toEnglish();
      return;
    }
    if (stored) {
      return;
    }
    const preferred = (navigator.languages ?? [navigator.language]).find(
      (lang) => lang?.toLowerCase().startsWith('de') || lang?.toLowerCase().startsWith('en'),
    );
    if (preferred?.toLowerCase().startsWith('en')) {
      toEnglish();
    }
  }, [locale, navigate]);

  return (
    <div className="isolate">
      <SiteHeader locale={locale} />
      <main>
        <Hero locale={locale} />
        <Manifesto locale={locale} />
        <Moments locale={locale} />
        <Promises locale={locale} />
        <Waitlist locale={locale} />
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}

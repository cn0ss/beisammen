import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Eyebrow } from '@/components/Eyebrow';
import { SiteHeader } from '@/components/SiteHeader';
import type { Locale } from '@/i18n/ui';

type PolicyShellProps = {
  locale: Locale;
  page: 'privacy' | 'delete-account';
  eyebrow: string;
  titlePlain: string;
  titleItalic: string;
  lede: string;
  meta?: string;
  backHref: string;
  backLabel: string;
  children: ReactNode;
};

export function PolicyShell({
  locale,
  page,
  eyebrow,
  titlePlain,
  titleItalic,
  lede,
  meta,
  backHref,
  backLabel,
  children,
}: PolicyShellProps) {
  return (
    <div className="isolate">
      <SiteHeader locale={locale} page={page} showNav={page === 'privacy'} />
      <main className="px-4 pt-12 pb-24 sm:px-6 sm:pt-16 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <header className="flex flex-col gap-4">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className="max-w-[20ch] text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
              {titlePlain}{' '}
              <em className="font-serif font-normal text-ember italic">{titleItalic}</em>
            </h1>
            <p className="max-w-[48ch] text-lg/8 text-pretty text-ink/70">{lede}</p>
            {meta && (
              <p className="font-mono text-xs tracking-widest text-ink/40 uppercase">{meta}</p>
            )}
          </header>

          <div className="prose mt-12 max-w-[70ch]">{children}</div>

          <Link
            to={backHref}
            className="mt-14 inline-block font-mono text-sm tracking-wide text-ink/40 hover:text-ember"
          >
            ← {backLabel}
          </Link>
        </div>
      </main>
    </div>
  );
}

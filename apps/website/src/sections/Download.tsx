import { Reveal } from '@/components/Reveal';
import { appStoreUrl, dict, playStoreUrl, type Locale } from '@/i18n/ui';

export function Download({ locale }: { locale: Locale }) {
  const t = dict[locale];

  return (
    <section id="download" className="scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="relative isolate mx-auto max-w-7xl overflow-hidden rounded-4xl bg-ink px-6 py-20 text-cream sm:px-12 sm:py-28">
        <div
          aria-hidden="true"
          className="absolute -inset-2/5 -z-10 animate-drift bg-[radial-gradient(circle_at_50%_100%,rgb(196_101_74/0.3),transparent_55%)]"
        />

        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="inline-flex items-center gap-2.5 font-mono text-xs tracking-widest text-blush uppercase">
            <span aria-hidden="true" className="h-px w-7 bg-current opacity-60" />
            {t.download.eyebrow}
          </p>
          <h2 className="mx-auto mt-6 max-w-[24ch] text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
            {t.download.title}
          </h2>
          <p className="mx-auto mt-6 max-w-[48ch] text-lg/8 text-pretty text-cream/75">
            {t.download.body}
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href={appStoreUrl}
              rel="noopener noreferrer"
              className="transition-transform duration-250 ease-(--ease-quiet) hover:-translate-y-0.5"
            >
              <img
                src={`/badges/app-store-${locale}.svg`}
                alt={t.download.appStore}
                width={120}
                height={40}
                loading="lazy"
                className="h-13 w-auto sm:h-14"
              />
            </a>
            <a
              href={playStoreUrl}
              rel="noopener noreferrer"
              className="transition-transform duration-250 ease-(--ease-quiet) hover:-translate-y-0.5"
            >
              <img
                src={`/badges/google-play-${locale}.svg`}
                alt={t.download.playStore}
                width={135}
                height={40}
                loading="lazy"
                className="h-13 w-auto sm:h-14"
              />
            </a>
          </div>

          <p className="mt-6 font-mono text-xs tracking-wide text-cream/45">{t.download.note}</p>
        </Reveal>
      </div>
    </section>
  );
}

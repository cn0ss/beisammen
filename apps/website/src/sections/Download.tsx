import { AppleIcon, PlayIcon } from 'lucide-react';
import { Reveal } from '@/components/Reveal';
import { Button } from '@/components/ui/button';
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

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              className="h-14 rounded-full bg-cream py-0 pr-7 pl-5 text-base text-ink hover:-translate-y-0.5 hover:bg-cream sm:h-13"
              nativeButton={false}
              render={<a href={appStoreUrl} rel="noopener noreferrer" />}
            >
              <AppleIcon aria-hidden="true" className="size-5 shrink-0 fill-ink" />
              {t.download.appStore}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-14 rounded-full border-cream/50 bg-cream/10 py-0 pr-7 pl-5 text-base text-cream backdrop-blur-sm hover:-translate-y-0.5 hover:bg-cream/20 hover:text-cream sm:h-13"
              nativeButton={false}
              render={<a href={playStoreUrl} rel="noopener noreferrer" />}
            >
              <PlayIcon aria-hidden="true" className="size-5 shrink-0 fill-cream stroke-cream" />
              {t.download.playStore}
            </Button>
          </div>

          <p className="mt-6 font-mono text-xs tracking-wide text-cream/45">{t.download.note}</p>
        </Reveal>
      </div>
    </section>
  );
}

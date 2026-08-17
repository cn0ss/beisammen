import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { dict, localePath, type Locale } from '@/i18n/ui';
import { images } from '@/lib/assets';

export function Hero({ locale }: { locale: Locale }) {
  const t = dict[locale];
  const home = localePath(locale, '');

  return (
    <section className="px-4 pt-2 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="relative isolate overflow-hidden rounded-4xl bg-ink">
          <img
            src={images.hero}
            alt={t.hero.imageAlt}
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-t from-ink/75 via-ink/30 to-ink/20"
          />

          <div className="relative flex min-h-[560px] items-center justify-center px-5 py-20 sm:min-h-[660px] sm:px-10">
            <div className="text-center">
              <p className="animate-rise font-mono text-xs tracking-widest text-cream/80 uppercase">
                {t.hero.eyebrow}
              </p>

              <h1
                className="mt-5 animate-rise text-[clamp(3.25rem,12.5vw,10rem)] leading-none font-extrabold tracking-tighter text-cream [animation-delay:80ms]"
              >
                beisammen<span className="text-ember">.</span>
              </h1>

              <p className="mx-auto mt-6 max-w-[40ch] animate-rise text-2xl font-semibold tracking-tight text-balance text-cream sm:text-3xl [animation-delay:180ms]">
                {t.hero.title}
              </p>

              <p className="mx-auto mt-4 max-w-[56ch] animate-rise text-lg/8 text-pretty text-cream/85 sm:text-base/7 [animation-delay:260ms]">
                {t.hero.lede}
              </p>

              <div className="mt-9 flex animate-rise flex-wrap items-center justify-center gap-3 [animation-delay:340ms]">
                <Button
                  size="lg"
                  className="h-13 rounded-full bg-cream px-7 text-base text-ink hover:-translate-y-0.5 hover:bg-cream"
                  nativeButton={false}
                  render={<Link to={`${home}#download`} />}
                >
                  {t.hero.primaryCta}
                  <span aria-hidden="true" className="transition-transform duration-250 ease-(--ease-quiet) group-hover/button:translate-x-0.5">
                    →
                  </span>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-13 rounded-full border-cream/50 bg-cream/10 px-7 text-base text-cream backdrop-blur-sm hover:-translate-y-0.5 hover:bg-cream/20 hover:text-cream"
                  nativeButton={false}
                  render={<Link to={`${home}#why`} />}
                >
                  {t.hero.secondaryCta}
                </Button>
              </div>

              <ul
                role="list"
                className="mt-10 flex animate-rise flex-wrap items-center justify-center gap-x-7 gap-y-3 font-mono text-xs tracking-wide text-cream/70 [animation-delay:420ms]"
              >
                {t.hero.metaItems.map((item) => (
                  <li key={item} className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="size-1 rounded-full bg-ember" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

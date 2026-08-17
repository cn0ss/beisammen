import { Eyebrow } from '@/components/Eyebrow';
import { Reveal } from '@/components/Reveal';
import { dict, type Locale } from '@/i18n/ui';

export function Manifesto({ locale }: { locale: Locale }) {
  const t = dict[locale];

  return (
    <section id="why" className="scroll-mt-24 px-4 py-20 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <Eyebrow>{t.manifesto.eyebrow}</Eyebrow>
          <h2 className="mt-6 max-w-[24ch] text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
            {t.manifesto.title}
          </h2>
          <p className="mt-8 max-w-[48ch] text-xl/8 text-pretty text-ink/70 sm:text-lg/8">
            {t.manifesto.body}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

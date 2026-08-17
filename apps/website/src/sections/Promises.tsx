import { Eyebrow } from '@/components/Eyebrow';
import { Reveal } from '@/components/Reveal';
import { dict, repoUrl, type Locale } from '@/i18n/ui';

export function Promises({ locale }: { locale: Locale }) {
  const t = dict[locale];

  return (
    <section id="promises" className="scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <Eyebrow>{t.promises.eyebrow}</Eyebrow>
          <h2 className="mt-5 max-w-[30ch] text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {t.promises.titlePlain}{' '}
            <em className="font-serif font-normal text-ember italic">{t.promises.titleItalic}</em>
          </h2>
        </Reveal>

        <Reveal delay={100}>
          <dl className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {t.promises.items.map((item, index) => (
              <div key={item.title} className="border-t border-ink/10 pt-6">
                <p className="font-mono text-xs tracking-widest text-ember">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <dt className="mt-4 text-base font-semibold text-ink">{item.title}</dt>
                <dd className="mt-2 max-w-[40ch] text-base/7 text-pretty text-ink/70 sm:text-sm/6">
                  {item.body}
                  {item.linkLabel && (
                    <>
                      {' '}
                      <a
                        href={repoUrl}
                        rel="noopener noreferrer"
                        className="border-b border-ember/40 text-ember hover:border-ember"
                      >
                        {item.linkLabel}
                      </a>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

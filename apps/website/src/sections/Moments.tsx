import { useRef, useState } from 'react';
import { Eyebrow } from '@/components/Eyebrow';
import { ImageOpenTilt } from '@/components/ImageOpenTilt';
import { Reveal } from '@/components/Reveal';
import { dict, type Locale, type MomentCircle } from '@/i18n/ui';
import { images } from '@/lib/assets';
import { cn } from '@/lib/utils';

const circleImages: Record<MomentCircle['key'], string> = {
  partner: images.circlePartner,
  family: images.circleFamily,
  friends: images.circleFriends,
};

export function Moments({ locale }: { locale: Locale }) {
  const t = dict[locale];
  const [activeKey, setActiveKey] = useState<MomentCircle['key']>('partner');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const circles = t.moments.circles;
  const active = circles.find((circle) => circle.key === activeKey) ?? circles[0];

  function onTablistKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
      return;
    }
    event.preventDefault();
    const index = circles.findIndex((circle) => circle.key === activeKey);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % circles.length
        : (index - 1 + circles.length) % circles.length;
    setActiveKey(circles[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <section id="circles" className="scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto grid max-w-7xl items-center gap-x-8 gap-y-14 lg:grid-cols-2">
        <Reveal>
          <Eyebrow>{t.moments.eyebrow}</Eyebrow>
          <h2 className="mt-5 max-w-[30ch] text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {t.moments.titlePlain}{' '}
            <em className="font-serif font-normal text-ember italic">{t.moments.titleItalic}</em>
          </h2>
          <p className="mt-6 max-w-[48ch] text-lg/8 text-pretty text-ink/70">{t.moments.body}</p>

          <div
            role="tablist"
            aria-label={t.moments.tablistLabel}
            onKeyDown={onTablistKeyDown}
            className="mt-9 flex flex-wrap gap-3"
          >
            {circles.map((circle, index) => {
              const selected = circle.key === active.key;
              return (
                <button
                  key={circle.key}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`circle-tab-${circle.key}`}
                  aria-selected={selected}
                  aria-controls="circle-moment"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveKey(circle.key)}
                  className={cn(
                    'group flex items-center gap-3 rounded-full py-2.5 pr-5 pl-3 transition-transform duration-250 ease-(--ease-quiet) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember',
                    selected
                      ? 'bg-ink text-cream'
                      : 'border border-ink/15 text-ink/70 hover:-translate-y-0.5 hover:text-ink',
                  )}
                >
                  <span className="flex -space-x-1.5" aria-hidden="true">
                    {circle.initials.slice(0, 3).map((initial) => (
                      <span
                        key={initial}
                        className={cn(
                          'flex size-6 items-center justify-center rounded-full font-mono text-[0.6rem] ring-2',
                          selected
                            ? 'bg-cream/20 text-cream ring-ink'
                            : 'bg-paper-deep text-ink/70 ring-paper',
                        )}
                      >
                        {initial}
                      </span>
                    ))}
                  </span>
                  <span className="text-left">
                    <span className="block text-sm font-medium">{circle.label}</span>
                    <span
                      className={cn(
                        'block font-mono text-[0.6rem] tracking-wide uppercase',
                        selected ? 'text-cream/60' : 'text-ink/40',
                      )}
                    >
                      {circle.members}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <ul
            key={active.key}
            role="list"
            className="mt-9 flex animate-rise flex-col gap-3 font-mono text-xs tracking-wide text-ink/60"
          >
            {active.facts.map((fact) => (
              <li key={fact} className="inline-flex items-center gap-2.5">
                <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-ember" />
                {fact}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={120}>
          <div
            id="circle-moment"
            role="tabpanel"
            aria-labelledby={`circle-tab-${active.key}`}
            className="mx-auto w-full max-w-xl"
          >
            <div key={active.key} className="animate-rise">
              <ImageOpenTilt
                src={circleImages[active.key]}
                alt={active.photoAlt}
                openLabel={t.moments.photoOpenLabel}
                closeLabel={t.moments.photoCloseLabel}
              />

              <figure className="relative z-10 mx-auto -mt-9 w-fit max-w-[88%] rounded-2xl bg-cream p-4 shadow-lg ring-1 ring-ink/5 sm:p-5">
                <figcaption className="flex items-baseline justify-between gap-6">
                  <span className="font-serif text-lg text-ink italic">{active.caption}</span>
                  <span className="font-mono text-[0.65rem] tracking-wide text-ink/40 uppercase">
                    {active.date}
                  </span>
                </figcaption>
                <div className="mt-3 flex items-center gap-3 border-t border-ink/10 pt-3">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blush font-mono text-[0.6rem] text-ink/70"
                  >
                    {active.reply.initial}
                  </span>
                  <p className="min-w-0 text-base/6 text-ink/80 sm:text-sm/5">
                    <span className="font-medium text-ink">{active.reply.name}</span>{' '}
                    {active.reply.text}
                  </p>
                  <span className="ml-auto shrink-0 font-mono text-[0.6rem] tracking-wide text-ink/40 tabular-nums">
                    {active.reply.time}
                  </span>
                </div>
              </figure>
            </div>

            <p className="mt-7 text-center font-mono text-xs tracking-wide text-ink/40">
              {t.moments.hint}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

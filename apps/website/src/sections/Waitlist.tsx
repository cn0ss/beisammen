import { useRef, useState, type FormEvent } from 'react';
import { Reveal } from '@/components/Reveal';
import { StatusBadge } from '@/components/StatusBadge';
import { useConfettiBurst } from '@/components/useConfettiBurst';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dict, type Locale } from '@/i18n/ui';
import { waitlistEndpoint } from '@/lib/instance';
import { cn } from '@/lib/utils';

type WaitlistStatus = 'idle' | 'pending' | 'success' | 'duplicate' | 'error' | 'unconfigured';

export function Waitlist({ locale }: { locale: Locale }) {
  const t = dict[locale];
  const [status, setStatus] = useState<WaitlistStatus>(
    waitlistEndpoint ? 'idle' : 'unconfigured',
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const burst = useConfettiBurst(stageRef, canvasRef, btnRef);

  const joined = status === 'success' || status === 'duplicate';
  const pending = status === 'pending';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!waitlistEndpoint || pending || joined) {
      return;
    }
    const form = event.currentTarget;
    setStatus('pending');
    try {
      const response = await fetch(waitlistEndpoint, {
        method: 'POST',
        body: new FormData(form),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; alreadyJoined?: boolean }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error('waitlist-submit-failed');
      }
      form.reset();
      if (payload.alreadyJoined) {
        setStatus('duplicate');
      } else {
        setStatus('success');
        burst();
      }
    } catch {
      setStatus('error');
    }
  }

  const statusMessage =
    status === 'success'
      ? t.waitlist.success
      : status === 'duplicate'
        ? t.waitlist.duplicate
        : status === 'error'
          ? t.waitlist.error
          : status === 'unconfigured'
            ? t.waitlist.configError
            : '';

  return (
    <section id="access" className="scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div
        ref={stageRef}
        className="t-confetti-stage relative isolate mx-auto max-w-7xl rounded-4xl bg-ink px-6 py-20 text-cream sm:px-12 sm:py-28"
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden rounded-4xl">
          <div className="absolute -inset-2/5 animate-drift bg-[radial-gradient(circle_at_50%_100%,rgb(196_101_74/0.3),transparent_55%)]" />
        </div>
        <canvas ref={canvasRef} className="t-confetti-canvas" aria-hidden="true" />

        <Reveal className="relative z-1 mx-auto max-w-2xl text-center">
          <p className="inline-flex items-center gap-2.5 font-mono text-xs tracking-widest text-blush uppercase">
            <span aria-hidden="true" className="h-px w-7 bg-current opacity-60" />
            {t.waitlist.eyebrow}
          </p>
          <h2 className="mx-auto mt-6 max-w-[24ch] text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
            {t.waitlist.titlePlain}{' '}
            <em className="font-serif font-normal text-blush italic">{t.waitlist.titleItalic}</em>
          </h2>
          <p className="mx-auto mt-6 max-w-[48ch] text-lg/8 text-pretty text-cream/75">
            {t.waitlist.body}
          </p>

          <form
            onSubmit={handleSubmit}
            aria-busy={pending}
            className="mx-auto mt-10 grid w-full max-w-md gap-3"
          >
            <Input
              type="email"
              name="email"
              required
              autoComplete="email"
              aria-label={t.waitlist.emailLabel}
              placeholder={t.waitlist.emailPlaceholder}
              disabled={status === 'unconfigured'}
              className="h-14 rounded-full border-cream/20 bg-cream/10 px-6 text-center text-lg/7 text-cream placeholder:text-cream/40 hover:bg-cream/15 focus-visible:ring-ember/40 sm:h-13 sm:text-base/7"
            />

            <input type="hidden" name="locale" value={locale} />
            {/* The Convex waitlist endpoint validates source as the literal
                'landing' — keep the value even though the app is now `website`. */}
            <input type="hidden" name="source" value="landing" />

            <Button
              ref={btnRef}
              type="submit"
              size="lg"
              disabled={pending || joined || status === 'unconfigured'}
              className="h-14 w-full gap-3 overflow-visible rounded-full bg-cream text-base text-ink hover:-translate-y-0.5 hover:bg-cream disabled:opacity-100 sm:h-13"
            >
              {(pending || joined) && (
                <StatusBadge
                  state={joined ? 'done' : 'loading'}
                  label={joined ? t.waitlist.statusDone : t.waitlist.pending}
                />
              )}
              {pending ? t.waitlist.pending : t.waitlist.primary}
              {status === 'idle' && (
                <span
                  aria-hidden="true"
                  className="transition-transform duration-250 ease-(--ease-quiet) group-hover/button:translate-x-0.5"
                >
                  →
                </span>
              )}
            </Button>

            <p className="text-center font-mono text-xs tracking-wide text-cream/45">
              {t.waitlist.footnote}
            </p>
            <p
              aria-live="polite"
              className={cn(
                'min-h-6 text-center text-base/6 sm:text-sm/6',
                joined ? 'text-sage' : 'text-blush',
              )}
            >
              {statusMessage}
            </p>
          </form>
        </Reveal>
      </div>
    </section>
  );
}

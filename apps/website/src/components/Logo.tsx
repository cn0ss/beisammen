import { cn } from '@/lib/utils';

type LogoProps = {
  size?: number;
  showWordmark?: boolean;
  className?: string;
};

export function Logo({ size = 26, showWordmark = true, className }: LogoProps) {
  const height = Math.round((size * 130) / 110);

  return (
    <span className={cn('inline-flex items-center gap-2 text-ink', className)}>
      <svg
        width={size}
        height={height}
        viewBox="0 0 110 130"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <line
          x1="22"
          y1="12"
          x2="22"
          y2="118"
          stroke="currentColor"
          strokeWidth="7.5"
          strokeLinecap="round"
        />
        <path
          d="M 22 62 Q 52 52, 66 75 Q 80 98, 66 112 Q 52 122, 22 115"
          stroke="currentColor"
          strokeWidth="7.5"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="95" cy="115" r="8.5" className="fill-ember" />
      </svg>
      {showWordmark && (
        <span className="font-semibold tracking-tighter">beisammen</span>
      )}
    </span>
  );
}

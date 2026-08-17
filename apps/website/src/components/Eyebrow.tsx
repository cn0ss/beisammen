import { cn } from '@/lib/utils';

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'inline-flex items-center gap-2.5 font-mono text-xs tracking-widest text-ink/50 uppercase',
        className,
      )}
    >
      <span aria-hidden="true" className="h-px w-7 bg-current opacity-60" />
      {children}
    </p>
  );
}

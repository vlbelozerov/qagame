import React from 'react';

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div
    className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}
    {...rest}
  />
);

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...rest
}) => <div className={cn('border-b border-slate-100 px-5 py-4', className)} {...rest} />;

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...rest
}) => <h3 className={cn('text-base font-semibold text-slate-900', className)} {...rest} />;

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...rest
}) => <div className={cn('px-5 py-4', className)} {...rest} />;

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-300',
  secondary:
    'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 focus:ring-slate-200',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-200',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-300',
};

const SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export const Button: React.FC<ButtonProps> = ({
  className,
  variant = 'primary',
  size = 'md',
  ...rest
}) => (
  <button
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
      'focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
      VARIANTS[variant],
      SIZES[size],
      className,
    )}
    {...rest}
  />
);

export const Badge: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({ className, ...rest }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
      'border-slate-200 bg-slate-100 text-slate-700',
      className,
    )}
    {...rest}
  />
);

export const Spinner: React.FC<{ className?: string }> = ({ className }) => (
  <span
    className={cn(
      'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
      className,
    )}
    aria-hidden
  />
);

export const Alert: React.FC<{ tone?: 'error' | 'info' | 'success'; children: React.ReactNode }> = ({
  tone = 'info',
  children,
}) => {
  const tones = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  } as const;
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-sm', tones[tone])} role="status">
      {children}
    </div>
  );
};

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ open, onClose, title, children, wide }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8">
      <div
        className={cn(
          'w-full rounded-xl bg-white shadow-xl',
          wide ? 'max-w-4xl' : 'max-w-2xl',
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть">
            ✕
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
};

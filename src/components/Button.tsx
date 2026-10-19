/* Adapted from design-web templates/button.tsx: roles, state layers, 2px ring.
   Radius follows the look plan (8px on controls) instead of the template capsule. */
import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../lib/cn'

export type ButtonVariant = 'normal' | 'primary' | 'quiet'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
  children?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  normal: 'bg-bg-surface text-text-primary border border-border-default',
  primary: 'bg-brand text-on-brand border border-transparent',
  quiet: 'bg-transparent text-text-secondary border border-transparent hover:text-text-primary'
}

/* Heights from the target floors: 24px WCAG 2.2 SC 2.5.8 minimum, 32px grid
   judgment, 40px M3 state-layer size; coarse pointers get 48px (>= 44px floor). */
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-24 min-w-24 px-8 text-caption gap-4',
  md: 'min-h-32 min-w-32 px-12 text-label gap-8 pointer-coarse:min-h-48',
  lg: 'min-h-40 min-w-40 px-16 text-label gap-8 pointer-coarse:min-h-48'
}

export function buttonClasses(variant: ButtonVariant = 'normal', size: ButtonSize = 'md', className?: string) {
  return cn(
    'focus-ring',
    'relative isolate inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-8 font-medium',
    'transition-colors duration-100 ease-standard',
    variantClasses[variant],
    sizeClasses[size],
    'before:pointer-events-none before:absolute before:inset-0 before:rounded-8 before:bg-current before:opacity-0',
    'hover:before:opacity-8 active:before:opacity-10 focus-visible:before:opacity-10',
    'disabled:pointer-events-none disabled:text-text-quaternary disabled:border-border-default disabled:bg-bg-surface',
    className
  )
}

export function Button({ variant = 'normal', size = 'md', loading = false, className, children, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      data-variant={variant}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading && (
        <span data-slot="button-spinner" className="inline-flex">
          <LoaderCircle className="size-16 motion-safe:animate-spin" aria-hidden="true" />
        </span>
      )}
      <span data-slot="button-label" className="inline-flex items-center gap-8">
        {children}
      </span>
    </button>
  )
}

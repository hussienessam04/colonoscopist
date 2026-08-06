// Minimal Accordion — single-item, collapsible, controlled/uncontrolled.
// Hand-ported rather than `@radix-ui/react-accordion` so Plan 02 ships
// without growing the dependency graph (per AGENTS.md: tech stack locked).
//
// API mirrors shadcn/ui so the call sites match the project convention;
// behaviour is the smallest slice the Procedure Notes panel needs:
//   - one item open at a time
//   - the open item can be closed (collapsible)
//   - defaultValue seeds the initial open item; undefined = starts collapsed
//   - chevron rotates via Tailwind's `data-[state]` selectors on the trigger

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type AccordionContextValue = {
  value: string | undefined;
  setValue: (next: string | undefined) => void;
};
const AccordionContext = React.createContext<AccordionContextValue | null>(null);

function useAccordion(): AccordionContextValue {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) throw new Error('Accordion components must be used inside <Accordion>');
  return ctx;
}

export type AccordionProps = {
  type?: 'single';
  collapsible?: boolean;
  defaultValue?: string;
  value?: string;
  onValueChange?: (next: string | undefined) => void;
  className?: string;
  children: React.ReactNode;
};

export function Accordion({
  collapsible = true,
  defaultValue,
  value,
  onValueChange,
  className,
  children,
}: AccordionProps): JSX.Element {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string | undefined>(defaultValue);
  const current = isControlled ? value : internal;

  const setValue = React.useCallback(
    (next: string | undefined) => {
      if (!collapsible && next === undefined) return;
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
    },
    [collapsible, isControlled, onValueChange],
  );

  return (
    <AccordionContext.Provider value={{ value: current, setValue }}>
      <div className={cn('w-full', className)} data-testid="accordion-root">
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export type AccordionItemProps = {
  value: string;
  className?: string;
  children: React.ReactNode;
};

export function AccordionItem({ value, className, children }: AccordionItemProps): JSX.Element {
  const ctx = useAccordion();
  const open = ctx.value === value;
  return (
    <div
      className={cn('border-b', className)}
      data-state={open ? 'open' : 'closed'}
      data-accordion-value={value}
    >
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<{ itemValue?: string; open?: boolean }>, {
              itemValue: value,
              open,
            })
          : child,
      )}
    </div>
  );
}

export type AccordionTriggerProps = {
  className?: string;
  children: React.ReactNode;
  // ponytail: internal props injected by AccordionItem — not part of the
  // public API but the cloneElement passes them through.
  itemValue?: string;
  open?: boolean;
};

export function AccordionTrigger({
  className,
  children,
  itemValue,
  open,
}: AccordionTriggerProps): JSX.Element {
  const ctx = useAccordion();
  const isOpen = open ?? (itemValue !== undefined && ctx.value === itemValue);
  return (
    <button
      type="button"
      onClick={() => {
        if (itemValue === undefined) return;
        ctx.setValue(isOpen ? undefined : itemValue);
      }}
      aria-expanded={isOpen}
      data-state={isOpen ? 'open' : 'closed'}
      className={cn(
        'flex w-full items-center justify-between gap-2 py-3 text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180',
        className,
      )}
    >
      {children}
      <ChevronDown
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200"
      />
    </button>
  );
}

export type AccordionContentProps = {
  className?: string;
  children: React.ReactNode;
  itemValue?: string;
  open?: boolean;
};

export function AccordionContent({
  className,
  children,
  itemValue,
  open,
}: AccordionContentProps): JSX.Element | null {
  const ctx = useAccordion();
  const isOpen = open ?? (itemValue !== undefined && ctx.value === itemValue);
  if (!isOpen) return null;
  return (
    <div
      data-state={isOpen ? 'open' : 'closed'}
      className={cn('pb-3 pt-0 text-sm', className)}
      data-accordion-content={itemValue}
    >
      {children}
    </div>
  );
}

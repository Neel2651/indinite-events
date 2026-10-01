import type { ReactNode } from "react";

/** A field the server flagged (`aria-invalid`, set by useFormAction) gets a red border. */
export const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive";

/** The server's message for one field, under the field (its id matches the field's aria-describedby). */
export function FieldError({ state, name }: { state: { fields?: Record<string, string> } | null | undefined; name: string }) {
  const message = state?.fields?.[name];
  if (!message) return null;
  return (
    <span id={`${name}-error`} className="mt-1 block text-xs font-semibold text-destructive">
      {message}
    </span>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

/** Centred card on cream, for sign-in style pages. */
export function AuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-brand-cream">
      <div className="mx-auto max-w-md px-5 py-14">
        <div className="card-brand space-y-5">
          <div>
            <h1 className="text-2xl">{title}</h1>
            {intro && <p className="mt-2 text-muted-foreground">{intro}</p>}
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

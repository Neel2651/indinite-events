import type { ReactNode } from "react";

export const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

/** Grey placeholder shapes shown by loading.tsx files while a page's data loads (1 Oct 2026). */
function Block({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-foreground/10 motion-reduce:animate-none ${className}`} />;
}

function Announce({ text = "Loading" }: { text?: string }) {
  return (
    <p role="status" className="sr-only">
      {text}
    </p>
  );
}

/** Event page: header, About and gallery, booking panel. */
export function EventPageLoading() {
  return (
    <>
      <Announce text="Loading the event" />
      <section className="dark bg-background">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-24">
          <Block className="h-7 w-44 rounded-full" />
          <Block className="mt-5 h-12 w-3/4 max-w-2xl" />
          <Block className="mt-4 h-6 w-1/2 max-w-md" />
          <Block className="mt-6 h-11 w-40 rounded-full" />
        </div>
      </section>
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Block className="h-8 w-32" />
          <Block className="h-4 w-full" />
          <Block className="h-4 w-5/6" />
          <Block className="mt-6 h-8 w-32" />
          <Block className="aspect-[16/9] w-full rounded-xl" />
        </div>
        <div className="card-brand h-fit space-y-4">
          <Block className="h-7 w-40" />
          <Block className="h-14 w-full" />
          <Block className="h-20 w-full" />
          <Block className="h-20 w-full" />
          <Block className="h-12 w-full rounded-full" />
        </div>
      </div>
    </>
  );
}

/** Organiser panel and admin: page title and a panel, inside the existing staff layout (the nav stays). */
export function StaffPageLoading() {
  return (
    <div>
      <Announce />
      <Block className="h-9 w-56" />
      <Block className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Block className="h-24" />
        <Block className="h-24" />
        <Block className="h-24" />
      </div>
      <div className="mt-6 space-y-3 rounded-lg border border-border bg-card p-6">
        <Block className="h-5 w-1/3" />
        <Block className="h-4 w-full" />
        <Block className="h-4 w-5/6" />
        <Block className="h-4 w-2/3" />
      </div>
    </div>
  );
}

/** Customer pages (confirmation, passes, find my tickets). */
export function CenteredLoading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-5 py-16">
      <div className="card-brand flex w-full items-center gap-3">
        <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-brand-orange border-t-transparent motion-reduce:animate-none" />
        <p role="status" className="font-semibold">
          {text}
        </p>
      </div>
    </div>
  );
}

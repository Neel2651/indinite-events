"use client";

import { useState } from "react";
import { createEventAction, updateEventAction } from "@/app/admin/events/actions";
import { FieldError, FormError, inputClass } from "./ui";
import { useFormAction } from "@/lib/use-form-action";

export interface NightRow {
  id?: string;
  label: string;
  /** London wall-clock, "2026-10-11T19:30". */
  start: string;
  end: string;
  /** Used by a pass type or issued passes: can't be removed. */
  locked?: boolean;
}

export interface EventFormValues {
  title: string;
  slug: string;
  description: string;
  venueName: string;
  venueAddress: string;
  postcode: string;
  mapUrl: string;
  lat: string;
  lng: string;
  nights: NightRow[];
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** Next night: same times, one day later. */
function nextNight(prev: NightRow | undefined, n: number): NightRow {
  const bump = (v: string) => {
    if (!v) return "";
    const d = new Date(`${v}:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 16);
  };
  return { label: `Night ${n}`, start: bump(prev?.start ?? ""), end: bump(prev?.end ?? "") };
}

/**
 * `organisers`: admin chooses the organiser. `organizerId`: fixed (an owner creating an event in their panel).
 * `returnTo`: the events list the new event's page lives under (admin or this organiser's panel).
 */
export function EventForm({
  eventId,
  organisers,
  organizerId,
  returnTo = "/admin/events",
  initial,
}: {
  eventId?: string;
  organisers?: { id: string; name: string }[];
  organizerId?: string;
  returnTo?: string;
  initial?: EventFormValues;
}) {
  const [state, action, pending] = useFormAction(eventId ? updateEventAction.bind(null, eventId) : createEventAction, null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial));
  const [nights, setNights] = useState<NightRow[]>(initial?.nights ?? [{ label: "Night 1", start: "", end: "" }]);

  const update = (i: number, patch: Partial<NightRow>) => setNights((ns) => ns.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  return (
    <form onSubmit={action} className="space-y-6">
      <input type="hidden" name="returnTo" value={returnTo} />
      {organizerId && <input type="hidden" name="organizerId" value={organizerId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {organisers && !organizerId && (
          <label className="block text-sm sm:col-span-2">
            Organiser
            <select name="organizerId" required className={inputClass} defaultValue="">
              <option value="" disabled>
                Choose an organiser
              </option>
              {organisers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm">
          Title
          <input
            name="title"
            required
            minLength={3}
            maxLength={140}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            className={inputClass}
            placeholder="e.g. Navratri 2026 — London Garba Nights"
          />
          <FieldError state={state} name="title" />
        </label>
        <label className="block text-sm">
          Web address
          <span className="mt-1 flex items-center gap-1 text-muted-foreground">
            <span className="shrink-0">/e/</span>
            <input
              name="slug"
              required
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              className={`${inputClass} mt-0 text-foreground`}
              aria-describedby="slug-help"
            />
          </span>
          <FieldError state={state} name="slug" />
          <span id="slug-help" className="mt-1 block text-xs text-muted-foreground">
            Lowercase letters, numbers and hyphens.{eventId ? " Changing it breaks links already shared." : ""}
          </span>
        </label>
        <label className="block text-sm sm:col-span-2">
          Description
          <textarea name="description" rows={5} maxLength={20000} defaultValue={initial?.description} className={inputClass} placeholder="What's on, dress code, food, parking…" />
        </label>
      </div>

      <fieldset className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 font-display font-semibold">Venue</legend>
        <label className="block text-sm">
          Name
          <input name="venueName" required maxLength={120} defaultValue={initial?.venueName} className={inputClass} />
          <FieldError state={state} name="venueName" />
        </label>
        <label className="block text-sm">
          Postcode
          <input name="postcode" required maxLength={10} defaultValue={initial?.postcode} className={`${inputClass} uppercase`} />
          <FieldError state={state} name="postcode" />
        </label>
        <label className="block text-sm sm:col-span-2">
          Address
          <input name="venueAddress" required maxLength={300} defaultValue={initial?.venueAddress} className={inputClass} />
          <FieldError state={state} name="venueAddress" />
        </label>
        <label className="block text-sm sm:col-span-2">
          Map link (optional)
          <input name="mapUrl" type="url" defaultValue={initial?.mapUrl} className={inputClass} placeholder="https://maps.google.com/…" />
          <FieldError state={state} name="mapUrl" />
        </label>
        <label className="block text-sm">
          Latitude (optional)
          <input name="lat" inputMode="decimal" defaultValue={initial?.lat} className={inputClass} placeholder="51.5072" />
          <FieldError state={state} name="lat" />
        </label>
        <label className="block text-sm">
          Longitude (optional)
          <input name="lng" inputMode="decimal" defaultValue={initial?.lng} className={inputClass} placeholder="-0.1276" />
          <FieldError state={state} name="lng" />
          <span className="mt-1 block text-xs text-muted-foreground">Used for the &ldquo;Get directions&rdquo; link on the event page.</span>
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-md border border-border p-4">
        <legend className="px-1 font-display font-semibold">Nights</legend>
        <p className="text-xs text-muted-foreground">Times are UK time. Pass types choose which nights they&apos;re valid for.</p>
        <input type="hidden" name="sessions" value={JSON.stringify(nights.map(({ locked: _l, ...n }) => n))} />
        <ol className="space-y-3">
          {nights.map((n, i) => (
            <li key={n.id ?? `new-${i}`} className="grid items-end gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="block text-sm">
                Name
                <input value={n.label} onChange={(e) => update(i, { label: e.target.value })} required maxLength={60} className={inputClass} />
              </label>
              <label className="block text-sm">
                Starts
                <input type="datetime-local" value={n.start} onChange={(e) => update(i, { start: e.target.value, ...(n.end ? {} : { end: e.target.value }) })} required className={inputClass} />
              </label>
              <label className="block text-sm">
                Ends
                <input type="datetime-local" value={n.end} min={n.start || undefined} onChange={(e) => update(i, { end: e.target.value })} required className={inputClass} />
              </label>
              <button
                type="button"
                disabled={nights.length === 1 || n.locked}
                onClick={() => setNights((ns) => ns.filter((_, j) => j !== i))}
                title={n.locked ? "A pass type or issued passes use this night" : undefined}
                className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
              >
                Remove<span className="sr-only"> {n.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setNights((ns) => [...ns, nextNight(ns.at(-1), ns.length + 1)])} className="rounded-full border border-border px-4 py-2 text-sm font-semibold">
          Add a night
        </button>
      </fieldset>

      <FormError message={state?.error} />
      {state?.ok && (
        <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          {state.ok}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-cta disabled:opacity-60">
        {pending ? "Saving…" : eventId ? "Save event" : "Create event as draft"}
      </button>
    </form>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { embedUrlFor } from "@indinite/core";
import { addVideoAction, removeMediaAction, reorderMediaAction, uploadImageAction, type ActionState } from "@/app/admin/events/actions";
import { FormError, inputClass } from "./ui";

export interface MediaItem {
  type: "image" | "video";
  url: string;
  alt: string;
}

function Ok({ state }: { state: ActionState }) {
  return state?.ok ? <p role="status" className="text-sm text-success">{state.ok}</p> : null;
}

export function MediaManager({ eventId, media }: { eventId: string; media: MediaItem[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(null);
  const run = (fn: () => Promise<ActionState>) => start(async () => setMsg(await fn()));
  const move = (i: number, by: -1 | 1) => {
    const urls = media.map((m) => m.url);
    const j = i + by;
    [urls[i], urls[j]] = [urls[j]!, urls[i]!];
    run(() => reorderMediaAction(eventId, urls));
  };

  return (
    <div className="space-y-6">
      {media.length === 0 ? (
        <p className="text-sm text-muted-foreground">No images or videos yet. The first image is used as the cover.</p>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((m, i) => (
            <li key={m.url} className="overflow-hidden rounded-md border border-border bg-background">
              {m.type === "image" ? (
                 
                <img src={m.url} alt={m.alt} className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">
                  Video · {embedUrlFor(m.url)?.includes("vimeo") ? "Vimeo" : "YouTube"}
                </div>
              )}
              <div className="space-y-2 p-3 text-sm">
                <p className="line-clamp-2">
                  {i === 0 && m.type === "image" && <span className="mr-1 rounded-full bg-brand-yellow px-2 py-0.5 text-xs font-semibold text-brand-navy">Cover</span>}
                  {m.alt}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={pending || i === 0} onClick={() => move(i, -1)} className="rounded-full border border-border px-3 py-1 text-xs font-semibold disabled:opacity-40">
                    Move earlier<span className="sr-only">: {m.alt}</span>
                  </button>
                  <button type="button" disabled={pending || i === media.length - 1} onClick={() => move(i, 1)} className="rounded-full border border-border px-3 py-1 text-xs font-semibold disabled:opacity-40">
                    Move later<span className="sr-only">: {m.alt}</span>
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => confirm(`Remove “${m.alt}”?`) && run(() => removeMediaAction(eventId, m.url))}
                    className="rounded-full border border-destructive px-3 py-1 text-xs font-semibold text-destructive disabled:opacity-40"
                  >
                    Remove<span className="sr-only">: {m.alt}</span>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <FormError message={msg?.error} />
      <Ok state={msg} />
      <div className="grid gap-6 lg:grid-cols-2">
        <UploadImage eventId={eventId} />
        <AddVideo eventId={eventId} />
      </div>
    </div>
  );
}

function UploadImage({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadImageAction.bind(null, eventId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-md border border-border p-4">
      <h3 className="font-display font-semibold">Upload an image</h3>
      <label className="block text-sm">
        Image (JPEG, PNG, WebP or AVIF, up to 5 MB)
        <input name="image" type="file" required accept="image/jpeg,image/png,image/webp,image/avif" className={inputClass} />
      </label>
      <label className="block text-sm">
        Describe the image (alt text)
        <input name="alt" required maxLength={200} className={inputClass} placeholder="e.g. Dancers in a circle under festival lights" />
      </label>
      <FormError message={state?.error} />
      <Ok state={state} />
      <button type="submit" disabled={pending} className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold disabled:opacity-60">
        {pending ? "Uploading…" : "Upload image"}
      </button>
    </form>
  );
}

function AddVideo({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addVideoAction.bind(null, eventId), null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-md border border-border p-4">
      <h3 className="font-display font-semibold">Add a video</h3>
      <label className="block text-sm">
        YouTube or Vimeo link
        <input name="url" type="url" required className={inputClass} placeholder="https://www.youtube.com/watch?v=…" />
      </label>
      <label className="block text-sm">
        Video title
        <input name="alt" required maxLength={200} className={inputClass} placeholder="e.g. Highlights from Navratri 2025" />
      </label>
      <FormError message={state?.error} />
      <Ok state={state} />
      <button type="submit" disabled={pending} className="rounded-full border border-border bg-card px-5 py-2.5 font-semibold disabled:opacity-60">
        {pending ? "Adding…" : "Add video"}
      </button>
    </form>
  );
}

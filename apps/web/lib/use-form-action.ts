"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import type { FormState } from "./form-state";

/**
 * Like useActionState, but the form keeps what was typed when the server reports an error (1 Oct 2026).
 * React 19 clears every field after a `<form action={…}>` submit, even on an error, so this submits through
 * `onSubmit` instead: `<form onSubmit={submit}>`.
 *
 * After each result, fields named in `state.fields` get `aria-invalid` (red border via `inputClass`) and the first
 * one is focused; show the message with `<FieldError state={state} name="…" />`. Forms that should clear on success
 * still call `form.reset()` themselves when `state.ok` is set.
 */
export function useFormAction<S extends FormState = FormState>(action: (prev: S, form: FormData) => Promise<S>, initial: S | null = null) {
  const [state, dispatch, pending] = useActionState<S, FormData>(
    action as unknown as (prev: Awaited<S>, form: FormData) => Promise<S>,
    initial as unknown as Awaited<S>,
  );
  const form = useRef<HTMLFormElement | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    form.current = e.currentTarget;
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };

  useEffect(() => {
    const el = form.current;
    if (!el) return;
    // Clear last time's marks, then mark the fields this result is about.
    for (const input of el.querySelectorAll<HTMLElement>("[data-server-invalid]")) {
      const errorId = input.getAttribute("data-server-invalid") ?? "";
      const rest = (input.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && id !== errorId);
      if (rest.length) input.setAttribute("aria-describedby", rest.join(" "));
      else input.removeAttribute("aria-describedby");
      input.removeAttribute("aria-invalid");
      input.removeAttribute("data-server-invalid");
    }
    const names = Object.keys(state?.fields ?? {});
    let first: HTMLElement | null = null;
    for (const name of names) {
      const field = el.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]:not([type="hidden"])`);
      if (!field) continue;
      const errorId = `${name}-error`;
      const described = (field.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("data-server-invalid", errorId);
      field.setAttribute("aria-describedby", [...described.filter((id) => id !== errorId), errorId].join(" "));
      first ??= field;
    }
    first?.focus();
  }, [state]);

  return [state, submit, pending] as const;
}

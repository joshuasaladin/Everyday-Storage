"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "./Icon";
import type { ActionState } from "@/lib/validate";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function SubmitButton({
  children,
  pendingLabel,
  className = "btn btn-primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}

/**
 * A form bound to a server action. Shows what the action reports back,
 * marks the fields it objected to, and keeps what was typed.
 */
export function ActionForm({
  action,
  children,
  className = "",
  submit = "Save",
  pendingLabel,
  cancelHref,
  submitClass,
  footer,
  onDone,
  resetOnOk,
  hideOk,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  submit?: React.ReactNode;
  pendingLabel?: string;
  cancelHref?: string;
  submitClass?: string;
  footer?: React.ReactNode;
  onDone?: () => void;
  resetOnOk?: boolean;
  hideOk?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    for (const name of Object.keys(state?.fields ?? {})) {
      form.querySelectorAll(`[name="${CSS.escape(name)}"]`).forEach((el) => el.setAttribute("aria-invalid", "true"));
    }
    if (state?.ok) {
      if (resetOnOk) form.reset();
      router.refresh();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const extra = Object.values(state?.fields ?? {}).filter((m) => m !== state?.error);

  return (
    <form ref={ref} action={formAction} className={className} noValidate={false}>
      {children}
      {state?.error && (
        <div className="notice notice-bad mt-4" role="alert">
          <Icon name="alert" className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            {state.error}
            {extra.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {extra.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
      {state?.ok && !hideOk && (
        <div className="notice notice-good mt-4" role="status">
          <Icon name="check" className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="break-all">{state.ok}</div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-5">
        <SubmitButton className={submitClass} pendingLabel={pendingLabel}>{submit}</SubmitButton>
        {cancelHref && <Link href={cancelHref} className="btn btn-ghost">Cancel</Link>}
        {footer}
      </div>
    </form>
  );
}

/** A dialog opened by a button; its children usually hold an ActionForm. */
export function Modal({
  label,
  title,
  blurb,
  children,
  className = "btn",
  icon,
  wide,
}: {
  label: React.ReactNode;
  title: string;
  blurb?: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  className?: string;
  icon?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {icon && <Icon name={icon} className="w-4 h-4" />}
        {label}
      </button>
      <dialog
        ref={ref}
        className="modal"
        style={wide ? { width: "min(46rem, calc(100vw - 2rem))" } : undefined}
        onClose={close}
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
      >
        {open && (
          <div className="p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="section-title" style={{ fontSize: "1.1rem" }}>{title}</h2>
                {blurb && <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{blurb}</p>}
              </div>
              <button type="button" className="btn btn-ghost btn-icon -mr-2 -mt-2" onClick={close} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            {typeof children === "function" ? children(close) : children}
          </div>
        )}
      </dialog>
    </>
  );
}

/** ActionForm inside a Modal that closes itself when the action succeeds. */
export function ModalForm({
  label,
  title,
  blurb,
  action,
  children,
  submit,
  className,
  icon,
  submitClass,
  wide,
}: {
  label: React.ReactNode;
  title: string;
  blurb?: React.ReactNode;
  action: Action;
  children: React.ReactNode;
  submit?: React.ReactNode;
  className?: string;
  icon?: string;
  submitClass?: string;
  wide?: boolean;
}) {
  return (
    <Modal label={label} title={title} blurb={blurb} className={className} icon={icon} wide={wide}>
      {(close) => (
        <ActionForm action={action} submit={submit} submitClass={submitClass} onDone={close} hideOk>
          {children}
        </ActionForm>
      )}
    </Modal>
  );
}

/** A one-click action with a confirmation step. Hidden fields ride along as `fields`. */
export function ConfirmButton({
  action,
  fields = {},
  label,
  confirm,
  className = "btn btn-sm",
  icon,
  title,
}: {
  action: Action;
  fields?: Record<string, string>;
  label: React.ReactNode;
  confirm?: string;
  className?: string;
  icon?: string;
  title?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton className={className} pendingLabel="Working…">
        {icon && <Icon name={icon} className="w-3.5 h-3.5" />}
        {label}
      </SubmitButton>
      {state?.error && <span className="text-xs max-w-xs" style={{ color: "var(--bad-fg)" }} role="alert">{state.error}</span>}
      {state?.ok && title !== "quiet" && state.ok !== "Saved." && <span className="text-xs max-w-xs break-all" style={{ color: "var(--good-fg)" }} role="status">{state.ok}</span>}
    </form>
  );
}

/** A GET form that applies itself: selects immediately, text after a short pause. */
export function AutoSubmitForm({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const go = () => {
    const form = ref.current;
    if (!form) return;
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries()) if (typeof v === "string" && v) params.set(k, v);
    router.replace(`${window.location.pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      onChange={(e) => {
        const el = e.target as HTMLElement;
        if (el.tagName === "SELECT" || (el as HTMLInputElement).type === "date" || (el as HTMLInputElement).type === "checkbox") go();
      }}
      onInput={(e) => {
        const el = e.target as HTMLInputElement;
        if (el.tagName !== "INPUT" || (el.type !== "text" && el.type !== "search")) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(go, 350);
      }}
    >
      {children}
    </form>
  );
}

/** A select that submits a server action the moment it changes (inline status edits). */
export function InlineSelect({
  action,
  name,
  value,
  options,
  fields = {},
  className = "select w-auto",
  ariaLabel,
}: {
  action: Action;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  fields?: Record<string, string>;
  className?: string;
  ariaLabel?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form ref={ref} action={formAction} className="inline-block">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <select name={name} defaultValue={value} className={className} aria-label={ariaLabel} onChange={() => ref.current?.requestSubmit()}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {state?.error && <div className="text-xs mt-1" style={{ color: "var(--bad-fg)" }}>{state.error}</div>}
    </form>
  );
}

/** A fresh idempotency key per form mount, so a double-submit books one payment. */
export function IdempotencyKey() {
  const [key] = useState(() => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random())));
  return <input type="hidden" name="idempotency_key" value={key} />;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt("Copy this link", text);
        }
      }}
    >
      <Icon name={done ? "check" : "clipboard"} className="w-3.5 h-3.5" />
      {done ? "Copied" : label}
    </button>
  );
}

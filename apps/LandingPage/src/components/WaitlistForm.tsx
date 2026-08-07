import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "../i18n/LocaleProvider";
import { submitWaitlist, type Persona } from "../lib/waitlist";

export function WaitlistForm() {
  const { locale, messages } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [persona, setPersona] = useState<Persona | "">("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "duplicate" | "error">("idle");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const nameInput = form.elements.namedItem("name");
    if (nameInput instanceof HTMLInputElement) {
      const nameIsBlank = name.trim().length === 0;
      nameInput.setCustomValidity(nameIsBlank ? messages.waitlist.error : "");
      if (nameIsBlank) setStatus("error");
    }
    if (!form.checkValidity()) return;
    setStatus("submitting");
    const result = await submitWaitlist({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      persona: persona as Persona,
      locale,
      source: "landing-page",
    });
    setStatus(result.status);
  }

  const dialogOpen = status !== "idle" && status !== "submitting";

  useEffect(() => {
    if (!dialogOpen) return;

    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStatus("idle");
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen]);

  const statusCopy = status === "success"
    ? { title: messages.waitlist.successTitle, message: messages.waitlist.success }
    : status === "duplicate"
      ? { title: messages.waitlist.duplicateTitle, message: messages.waitlist.duplicate }
      : { title: messages.waitlist.errorTitle, message: messages.waitlist.error };

  return (
    <>
      <form className="wait-form" aria-label={messages.nav.join} onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="waitlist-name">{messages.waitlist.name}</label>
        <input
          className="field"
          id="waitlist-name"
          name="name"
          type="text"
          value={name}
          placeholder={messages.waitlist.name}
          onChange={(event) => {
            event.currentTarget.setCustomValidity("");
            setName(event.target.value);
          }}
          autoComplete="name"
          required
        />

        <label className="field-label" htmlFor="waitlist-email">{messages.waitlist.email}</label>
        <input
          className="field"
          id="waitlist-email"
          name="email"
          type="email"
          value={email}
          placeholder={messages.waitlist.email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />

        <label className="field-label" htmlFor="waitlist-persona">{messages.waitlist.persona}</label>
        <select
          className="field field--select"
          id="waitlist-persona"
          name="persona"
          value={persona}
          onChange={(event) => setPersona(event.target.value as Persona)}
          required
        >
          <option value="" disabled>{messages.waitlist.persona}</option>
          <option value="idea">{messages.waitlist.personas.idea}</option>
          <option value="creator">{messages.waitlist.personas.creator}</option>
          <option value="investor">{messages.waitlist.personas.investor}</option>
        </select>

        <button className="submit" type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? messages.waitlist.submitting : messages.waitlist.submit}
        </button>
        <p className="privacy">{messages.waitlist.privacy}</p>
        <p className="form-status sr-only" role="status" aria-live="polite">
          {dialogOpen ? statusCopy.message : ""}
        </p>
      </form>
      {dialogOpen && (
        <div
          className={`waitlist-dialog-backdrop waitlist-dialog-backdrop--${status}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setStatus("idle");
          }}
        >
          <section
            aria-describedby="waitlist-dialog-message"
            aria-labelledby="waitlist-dialog-title"
            aria-modal="true"
            className="waitlist-dialog"
            role="dialog"
          >
            <span aria-hidden="true" className="waitlist-dialog__mark">
              {status === "success" ? "✓" : "!"}
            </span>
            <h2 id="waitlist-dialog-title">{statusCopy.title}</h2>
            <p id="waitlist-dialog-message">{statusCopy.message}</p>
            <button
              className="waitlist-dialog__close"
              onClick={() => setStatus("idle")}
              ref={closeButtonRef}
              type="button"
            >
              {messages.waitlist.close}
            </button>
          </section>
        </div>
      )}
    </>
  );
}

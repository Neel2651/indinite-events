import { Resend, type Attachment } from "resend";

let client: Resend | undefined;

function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  client ??= new Resend(key);
  return client;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Attachment[];
  /** Resend dedupes sends with the same key for 24 h, so a retried job can't email twice. */
  idempotencyKey: string;
  tags?: { name: string; value: string }[];
}

/** Sends via Resend; throws on failure so the job is retried. Returns the Resend email id. */
export async function sendEmail(email: OutgoingEmail): Promise<string> {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  const { data, error } = await resend().emails.send(
    {
      from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments,
      tags: email.tags,
    },
    { idempotencyKey: email.idempotencyKey },
  );
  if (error || !data) throw new Error(`Resend: ${error?.name ?? "error"}: ${error?.message ?? "no response"}`);
  return data.id;
}

export function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL is not set");
  return url.replace(/\/+$/, "");
}

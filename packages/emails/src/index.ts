import { render } from "@react-email/components";
import { createElement } from "react";
import { InvitationEmail, invitationSubject, PaymentLinkEmail, paymentLinkSubject, ResetPasswordEmail, resetPasswordSubject, type InvitationEmailData, type PaymentLinkEmailData, type ResetPasswordEmailData } from "./staff-emails";
import { TicketsEmail, subjectFor } from "./tickets-email";
import type { TicketsEmailData } from "./types";

export type { PassData, TicketsEmailData } from "./types";
export { renderPassesPdf } from "./pass-pdf";
export type { InvitationEmailData, PaymentLinkEmailData, ResetPasswordEmailData } from "./staff-emails";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderTicketsEmail(d: TicketsEmailData): Promise<RenderedEmail> {
  const el = createElement(TicketsEmail, d);
  return { subject: subjectFor(d), html: await render(el), text: await render(el, { plainText: true }) };
}

export async function renderInvitationEmail(d: InvitationEmailData): Promise<RenderedEmail> {
  const el = createElement(InvitationEmail, d);
  return { subject: invitationSubject(d), html: await render(el), text: await render(el, { plainText: true }) };
}

export async function renderResetPasswordEmail(d: ResetPasswordEmailData): Promise<RenderedEmail> {
  const el = createElement(ResetPasswordEmail, d);
  return { subject: resetPasswordSubject(), html: await render(el), text: await render(el, { plainText: true }) };
}

export async function renderPaymentLinkEmail(d: PaymentLinkEmailData): Promise<RenderedEmail> {
  const el = createElement(PaymentLinkEmail, d);
  return { subject: paymentLinkSubject(d), html: await render(el), text: await render(el, { plainText: true }) };
}

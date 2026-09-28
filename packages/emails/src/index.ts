import { render } from "@react-email/components";
import { createElement } from "react";
import { InvitationEmail, invitationSubject, MerchantActiveEmail, merchantActiveSubject, MerchantSetupEmail, merchantSetupSubject, type MerchantEmailData, PaymentLinkEmail, paymentLinkSubject, RefundEmail, refundSubject, type RefundEmailData, ResetPasswordEmail, resetPasswordSubject, type InvitationEmailData, type PaymentLinkEmailData, type ResetPasswordEmailData } from "./staff-emails";
import { TicketsEmail, subjectFor } from "./tickets-email";
import type { TicketsEmailData } from "./types";

export type { PassData, TicketsEmailData } from "./types";
export { renderPassesPdf } from "./pass-pdf";
export type { InvitationEmailData, PaymentLinkEmailData, RefundEmailData, ResetPasswordEmailData } from "./staff-emails";

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

export async function renderMerchantSetupEmail(d: MerchantEmailData): Promise<RenderedEmail> {
  const el = createElement(MerchantSetupEmail, d);
  return { subject: merchantSetupSubject(d), html: await render(el), text: await render(el, { plainText: true }) };
}

export async function renderMerchantActiveEmail(d: MerchantEmailData): Promise<RenderedEmail> {
  const el = createElement(MerchantActiveEmail, d);
  return { subject: merchantActiveSubject(d), html: await render(el), text: await render(el, { plainText: true }) };
}

export async function renderRefundEmail(d: RefundEmailData): Promise<RenderedEmail> {
  const el = createElement(RefundEmail, d);
  return { subject: refundSubject(d), html: await render(el), text: await render(el, { plainText: true }) };
}

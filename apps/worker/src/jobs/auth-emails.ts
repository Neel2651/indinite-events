import type { SendAuthEmailJob } from "@indinite/db";
import { renderInvitationEmail, renderMerchantActiveEmail, renderMerchantSetupEmail, renderResetPasswordEmail } from "@indinite/emails";
import { sendEmail } from "../mailer";

/** send-auth-email: staff invitations and password resets. */
export async function sendAuthEmail(job: SendAuthEmailJob, jobId: string) {
  const email =
    job.kind === "invitation"
      ? await renderInvitationEmail({ organizationName: job.organizationName, role: job.role, inviterName: job.inviterName, url: job.url })
      : job.kind === "reset-password"
        ? await renderResetPasswordEmail({ name: job.name, url: job.url })
        : job.kind === "merchant-setup"
          ? await renderMerchantSetupEmail({ organizationName: job.organizationName, url: job.url })
          : await renderMerchantActiveEmail({ organizationName: job.organizationName, url: job.url });
  const id = await sendEmail({
    to: job.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `send-auth-email/${jobId}`,
    tags: [{ name: "type", value: job.kind }],
  });
  console.log(`[send-auth-email] sent ${job.kind} (${id})`);
}

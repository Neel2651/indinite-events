/**
 * Development seed: one organizer, one Navratri event with 9 nights, two ticket types.
 * Auth users (super admin, organizer owner) are added in M1 once Better Auth is wired up.
 */
import { runWithContext, systemActor } from "@indinite/core/context";
import { audited, connectDb, disconnectDb, Event, Organizer, TicketType, withTransaction } from "../src";

await connectDb();

await runWithContext({ actor: systemActor }, () =>
  withTransaction(async (session) => {
    const [organizer] = await Organizer.create(
      [
        {
          name: "Demo Garba Ltd",
          slug: "demo-garba",
          contactEmail: "owner@example.com",
          authOrgId: "seed-org",
          commissionBps: 800,
        },
      ],
      { session },
    );
    await audited(session, { action: "organizer.created", entity: { type: "organizer", id: organizer!._id }, after: organizer!.toObject(), organizerId: organizer!._id });

    // Nights run 19:30–23:30 London time (BST, UTC+1) from Sun 11 Oct 2026.
    const sessions = Array.from({ length: 9 }, (_, i) => ({
      label: `Night ${i + 1}`,
      startsAt: new Date(Date.UTC(2026, 9, 11 + i, 18, 30)),
      endsAt: new Date(Date.UTC(2026, 9, 11 + i, 22, 30)),
    }));

    const [event] = await Event.create(
      [
        {
          organizerId: organizer!._id,
          slug: "navratri-2026-demo",
          title: "Navratri 2026 — Demo Garba Nights",
          description: "Nine nights of garba and dandiya.",
          venue: { name: "Demo Hall", address: "1 Example Road, London", postcode: "E1 1AA" },
          sessions,
          status: "draft",
        },
      ],
      { session },
    );
    await audited(session, { action: "event.created", entity: { type: "event", id: event!._id }, after: event!.toObject(), organizerId: organizer!._id });

    const allNights = event!.sessions.map((s) => s._id);
    const types = await TicketType.create(
      [
        { eventId: event!._id, name: "Season pass — adult", pricePence: 4500, validSessionIds: allNights, quota: 500, sortOrder: 1 },
        { eventId: event!._id, name: "Season pass — child (5–12)", pricePence: 2000, validSessionIds: allNights, quota: 200, sortOrder: 2 },
      ],
      { session },
    );
    for (const t of types) {
      await audited(session, { action: "ticketType.created", entity: { type: "ticketType", id: t._id }, after: t.toObject(), organizerId: organizer!._id });
    }
    console.log(`Seeded organizer ${organizer!.slug}, event ${event!.slug}, ${types.length} ticket types`);
  }),
);

await disconnectDb();

/** Cookie holding the buyer's 30-minute order link on the confirmation page (set by proxy.ts, read by the page). */
export const orderLinkCookie = (publicId: string) => `order_link_${publicId}`;

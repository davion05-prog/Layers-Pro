import { z } from "zod";

export const browserSubscription = z.object({
  endpoint: z
    .url()
    .max(1024)
    .refine((raw) => {
      const url = new URL(raw);
      return (
        url.protocol === "https:" &&
        !url.port &&
        !url.username &&
        !url.password &&
        [
          "fcm.googleapis.com",
          "updates.push.services.mozilla.com",
          "web.push.apple.com",
          "notify.windows.com",
        ].some(
          (host) => url.hostname === host || url.hostname.endsWith("." + host),
        )
      );
    }),
  keys: z.object({ auth: z.string().max(100), p256dh: z.string().max(150) }),
});

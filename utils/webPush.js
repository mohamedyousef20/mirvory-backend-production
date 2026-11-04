import webpush from "web-push";
import PushSubscription from "../models/pushSubscription.model.js";
import User from "../models/user.model.js";

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (enabled) {
  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:admin@mirvory.net",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn("[webPush] VAPID keys missing — push notifications disabled.");
}

export const getVapidPublicKey = () => (enabled ? VAPID_PUBLIC_KEY : null);

// Sends a push to every subscribed device of every admin user.
// Subscriptions that the browser has revoked (404/410) are removed.
export const sendPushToAdmins = async (payload) => {
  if (!enabled) return;

  const admins = await User.find({ role: "admin" }).select("_id").lean();
  if (admins.length === 0) return;

  const subs = await PushSubscription.find({
    userId: { $in: admins.map((a) => a._id) },
  }).lean();

  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body,
          { TTL: 60 * 60 }
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          console.error("[webPush] send failed:", err.statusCode || err.message);
        }
      }
    })
  );
};

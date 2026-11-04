import PushSubscription from "../models/pushSubscription.model.js";
import { getVapidPublicKey } from "../utils/webPush.js";

export const getVapidKey = (req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({ message: "Push notifications are not configured" });
  }
  res.json({ publicKey });
};

export const subscribe = async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: "Invalid push subscription" });
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        userId: req.user._id,
        endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: req.get("user-agent") || "",
      },
      { upsert: true, new: true }
    );
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const unsubscribe = async (req, res, next) => {
  try {
    await PushSubscription.deleteOne({
      endpoint: req.body?.endpoint,
      userId: req.user._id,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

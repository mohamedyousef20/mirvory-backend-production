import express from "express";
import { getVapidKey, subscribe, unsubscribe } from "../controllers/push.controller.js";
import { isAdmin, protect } from "../middlewares/auth.js";

const router = express.Router();

router.get("/vapid-public-key", getVapidKey);
router.post("/subscribe", protect, isAdmin, subscribe);
router.post("/unsubscribe", protect, isAdmin, unsubscribe);

export default router;

// services/notification.service.js
import Notification from "../models/notification.model.js";
import User from "../models/user.model.js";

export const createNotifications = async ({
    io,
    title,
    message,
    type,
    actor = null,
    userId = [],
    role = null,
    data = {},
    link = "",
}) => {
    let recipients = [];

    if (userId.length > 0) {
        recipients = await User.find({ _id: { $in: userId } }).select("_id role");
        if (recipients.length !== userId.length) {
            throw new Error("Some users not found");
        }
    } else if (role) {
        recipients = await User.find({ role }).select("_id role");
    } else {
        recipients = await User.find({}).select("_id role");
    }

    // 🔒 ROLE ISOLATION FIX: Only set userId for individual notifications
    // Don't set role field for individual notifications to prevent cross-role leakage
    const docs = recipients.map((user) => ({
        userId: user._id,
        role: undefined, // 🔒 Remove role field to prevent cross-role leakage
        actor,
        title,
        message,
        type,
        data,
        link,
        seen: false,
    }));

    const saved = await Notification.insertMany(docs);

    if (io) {
        console.log('Emitting notifications to', saved.length, 'recipients');
        saved.forEach((notif) => {
            console.log('Emitting to user room:', String(notif.userId));
            io.to(String(notif.userId)).emit("notification", {
                _id: notif._id,
                title: notif.title,
                message: notif.message,
                type: notif.type,
                data: notif.data,
                link: notif.link,
                createdAt: notif.createdAt,
            });
        });
    } else {
        console.log('No io instance provided, notifications not emitted in real-time');
    }

    return saved;
};
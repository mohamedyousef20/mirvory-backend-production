// services/notification.service.js
import Notification from "../models/notification.model.js";
import User from "../models/user.model.js";

export const createNotifications = async ({
    io,
    title,
    message,
    type,
    actor = null,
    userIds = [],
    role = null,
    data = {},
    link = "",
}) => {
    let recipients = [];

    if (userIds.length > 0) {
        recipients = await User.find({ _id: { $in: userIds } }).select("_id role");
        if (recipients.length !== userIds.length) {
            throw new Error("Some users not found");
        }
    } else if (role) {
        recipients = await User.find({ role }).select("_id role");
    } else {
        recipients = await User.find({}).select("_id role");
    }

    const docs = recipients.map((user) => ({
        user: user._id,
        role: user.role,
        actor,
        title,
        message,
        type,
        data,
        link,
        is_read: false,
    }));

    const saved = await Notification.insertMany(docs);

    if (io) {
        saved.forEach((notif) => {
            io.to(String(notif.user)).emit("notification", {
                _id: notif._id,
                title: notif.title,
                message: notif.message,
                type: notif.type,
                data: notif.data,
                link: notif.link,
                createdAt: notif.createdAt,
            });
        });
    }

    return saved;
};
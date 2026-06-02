// server.js
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import connectDB from "./config/db.js";
import mountRoutes from "./routes/index.route.js";
import User from "./models/user.model.js";
import SearchHistory from "./models/searchHistory.model.js";

dotenv.config({ path: "./.env" });

const app = express();

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
}));
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

connectDB();

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
});

app.set("io", io);

// helper to read cookies from socket handshake
const parseCookie = (cookieHeader = "") => {
  return Object.fromEntries(
    cookieHeader.split(";").map((part) => {
      const [key, ...val] = part.trim().split("=");
      return [key, decodeURIComponent(val.join("="))];
    }).filter(([key]) => key)
  );
};

io.use(async (socket, next) => {
  try {
    const cookies = parseCookie(socket.request.headers.cookie || "");
    const token = cookies.accessToken;

    if (!token) return next(new Error("Unauthorized"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("_id role firstName lastName");

    if (!user) return next(new Error("Unauthorized"));

    socket.user = user;
    next();
  } catch (error) {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(String(socket.user._id));
  socket.join(socket.user.role); // useful for admin/seller broadcasts
  console.log("User connected:", socket.id, socket.user._id.toString());

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

mountRoutes(app);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
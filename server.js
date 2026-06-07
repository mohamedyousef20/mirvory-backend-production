// server.js
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import connectDB from "./config/db.js";
import mountRoutes from "./routes/index.route.js";
import User from "./models/user.model.js";
import SearchHistory from "./models/searchHistory.model.js";

dotenv.config({ path: "./.env" });

const app = express();

// 🛡️ RATE LIMITING: Protect against DoS and brute force attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (increased for development)
  message: { message: "Too many requests from this IP, please try again later." },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 login attempts per windowMs (increased for development)
  message: { message: "Too many login attempts, please try again later." },
  skipSuccessfulRequests: true,
});

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
}));
app.use(morgan("dev"));
app.use(limiter); 
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

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("ERROR:", err);

  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "حدث خطأ غير متوقع",
    status: statusCode,
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
    }),
  });
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
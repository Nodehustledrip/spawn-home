"use strict";
const express = require("express");
const path = require("path");
const app = express();
const ai = require("./ai");
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(function (_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join("; ")
  );
  next();
});

app.use(express.static(path.join(__dirname, "public")));
ai.mount(app);
app.get("/api/health", (_req, res) => res.json({ ok: true, app: "Spawn Home" }));
app.listen(PORT, "0.0.0.0", () => console.log("Spawn Home listening on " + PORT));

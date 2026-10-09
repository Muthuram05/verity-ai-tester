import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
const fixtures = new Map();
let mode = "fixed";
const newState = () => ({
  profile: "Alex Morgan",
  bio: "Building things that work.",
  posts: [
    {
      id: "1",
      owner: "alex",
      text: "A small update can make a big difference.",
    },
    { id: "2", owner: "sam", text: "Testing gives us confidence to ship." },
  ],
  comments: [],
  sessions: new Map(),
});
const json = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};
const body = async (req) => {
  let b = "";
  for await (const c of req) {
    b += c;
    if (b.length > 65536) throw Error("Large body");
  }
  return b ? JSON.parse(b) : {};
};
const html = fs.readFileSync(new URL("./index.html", import.meta.url));
http
  .createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://demo").pathname;
      if (path === "/__build")
        return json(res, 200, {
          id: `demo-${mode}-v1`,
          commit: `demo-${mode}-v1`,
          mode,
        });
      if (path === "/__control") {
        if (req.headers["x-demo-key"] !== process.env.DEMO_KEY)
          return json(res, 403, {});
        const b = await body(req);
        if (["fixed", "buggy"].includes(b.mode)) mode = b.mode;
        return json(res, 200, { mode });
      }
      if (path === "/__fixtures" && req.method === "POST") {
        if (req.headers["x-demo-key"] !== process.env.DEMO_KEY)
          return json(res, 403, {});
        const requested = (await body(req)).id;
        if (requested && !/^[0-9a-f-]{36}$/i.test(requested))
          return json(res, 422, {});
        const id = requested || crypto.randomUUID();
        fixtures.set(id, newState());
        return json(res, 201, { id });
      }
      if (path.startsWith("/__fixtures/") && req.method === "DELETE") {
        const id = path.split("/").pop();
        if (req.headers["x-demo-key"] !== process.env.DEMO_KEY)
          return json(res, 403, {});
        fixtures.delete(id);
        return json(res, 200, { deleted: true });
      }
      const cookies = Object.fromEntries(
        (req.headers.cookie || "")
          .split(";")
          .filter(Boolean)
          .map((v) => v.trim().split("=")),
      );
      let fixture = req.headers["x-demo-fixture"] || cookies.demo_fixture;
      if (!fixture) {
        fixture = crypto.randomUUID();
        fixtures.set(fixture, newState());
        res.setHeader(
          "Set-Cookie",
          `demo_fixture=${fixture}; HttpOnly; SameSite=Strict; Path=/`,
        );
      }
      const state = fixtures.get(fixture);
      if (!state) return json(res, 404, { error: "Fixture expired" });
      const session = state.sessions.get(cookies.demo_session);
      const b = ["POST", "PATCH", "DELETE"].includes(req.method)
        ? await body(req)
        : {};
      if (path === "/api/login") {
        if (
          !["alex@example.test", "sam@example.test"].includes(b.email) ||
          b.password !== "demo-password"
        )
          return json(res, 401, { error: "Email or password is incorrect" });
        const sid = crypto.randomUUID();
        state.sessions.set(sid, b.email.startsWith("alex") ? "alex" : "sam");
        res.setHeader(
          "Set-Cookie",
          `demo_session=${sid}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return json(res, 200, { ok: true });
      }
      if (path === "/api/logout") {
        state.sessions.delete(cookies.demo_session);
        return json(res, 200, { ok: true });
      }
      if (path.startsWith("/api/")) {
        if (!session) return json(res, 401, { error: "Sign in to continue" });
        if (path === "/api/state")
          return json(res, 200, {
            profile: state.profile,
            bio: state.bio,
            posts: state.posts,
            comments: state.comments,
            user: session,
            mode,
          });
        if (path === "/api/profile") {
          if (!String(b.name || "").trim())
            return json(res, 422, { error: "Display name is required" });
          if (mode === "fixed") {
            state.profile = b.name;
            state.bio = b.bio;
          }
          return json(res, 200, { ok: true });
        }
        if (path === "/api/posts" && req.method === "POST") {
          if (!String(b.text || "").trim() && mode === "fixed")
            return json(res, 422, {
              error: "Write something before publishing",
            });
          state.posts.unshift({
            id: crypto.randomUUID(),
            owner: session,
            text: b.text,
          });
          return json(res, 200, { ok: true });
        }
        if (path.startsWith("/api/posts/")) {
          const id = path.split("/").pop();
          const post = state.posts.find((p) => p.id === id);
          if (!post) return json(res, 404, { error: "Post not found" });
          if (post.owner !== session)
            return json(res, 403, {
              error: "You can only edit your own posts",
            });
          if (req.method === "DELETE")
            state.posts = state.posts.filter((p) => p.id !== id);
          else post.text = b.text;
          return json(res, 200, { ok: true });
        }
        if (path === "/api/comments") {
          if (!String(b.text || "").trim())
            return json(res, 422, { error: "Comment cannot be empty" });
          state.comments.push(b.text);
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: "Not found" });
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    } catch {
      json(res, 500, { error: "Demo request failed" });
    }
  })
  .listen(4174, "0.0.0.0", () => console.log("Owned demo listening on 4174"));

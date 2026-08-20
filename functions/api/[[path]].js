import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Client } from "pg";

const requestContext = new AsyncLocalStorage();
const loginAttempts = new Map();

function contextStore() {
  const store = requestContext.getStore();
  if (!store) throw new Error("Request context unavailable.");
  return store;
}

async function query(text, params = []) {
  return contextStore().client.query(text, params);
}

async function withTransaction(callback) {
  const client = contextStore().client;
  await client.query("BEGIN");
  try {
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  }
}

async function testConnection() {
  const result = await query("select current_database() as database, now() as server_time");
  return result.rows[0];
}

const ALL_PERMISSIONS = [
  "edit_wiki",
  "edit_staff",
  "access_control",
  "manage_access"
];

const ALLOWED_ROLES = [
  "Owner",
  "Admin",
  "Developer",
  "Moderator",
  "Helper"
];

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(JSON.stringify(value));
}

function sendText(res, status, value, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff"
  });
  res.end(value);
}

async function readBody(req) {
  if (req._cfRequest) {
    const length = Number(req.headers["content-length"] || 0);
    if (length > 1024 * 1024) throw new Error("Payload too large");
    const text = await req._cfRequest.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw new Error("Invalid JSON"); }
  }
  return {};
}

function parseCookies(req) {
  const out = {};

  for (const piece of String(req.headers.cookie || "").split(";")) {
    const index = piece.indexOf("=");
    if (index === -1) continue;

    out[piece.slice(0, index).trim()] =
      decodeURIComponent(piece.slice(index + 1).trim());
  }

  return out;
}

function sessionCookie(token, maxAge = 43200) {
  return `firefly_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function sanitizeUser(user) {
  if (!user) return null;

  return {
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role || "Player",
    staff: !!user.staff,
    permissions: Array.isArray(user.permissions) ? user.permissions : []
  };
}

function sessionSecret() {
  const secret = String(contextStore().env.SESSION_SECRET || "");
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters.");
  }
  return secret;
}

function signSessionPayload(payload) {
  return crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

function createSession(user) {
  const payload = Buffer.from(JSON.stringify({
    user: sanitizeUser(user),
    exp: Date.now() + 1000 * 60 * 60 * 12
  })).toString("base64url");
  return `${payload}.${signSessionPayload(payload)}`;
}

function getSession(req) {
  const token = parseCookies(req).firefly_session;
  if (!token || !token.includes(".")) return null;

  try {
    const [payload, signature] = token.split(".");
    const expected = signSessionPayload(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.user || Number(parsed.exp || 0) < Date.now()) return null;
    return { user: sanitizeUser(parsed.user), expiresAt: parsed.exp };
  } catch {
    return null;
  }
}

function hasPermission(user, permission) {
  if (!user?.staff) return false;
  if (user.role === "Owner") return true;

  return Array.isArray(user.permissions) &&
    user.permissions.includes(permission);
}

function requirePermission(req, res, permission) {
  const session = getSession(req);

  if (!session || !hasPermission(session.user, permission)) {
    sendJson(res, 403, {
      error: "You do not have access to this action."
    });
    return null;
  }

  return session;
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function usernameKey(value) {
  return normalizeUsername(value).toLowerCase();
}

function validUsername(value) {
  return /^[A-Za-z0-9_]{3,16}$/.test(value);
}

function validPin(value) {
  return /^\d{8}$/.test(String(value || ""));
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(
    String(pin),
    salt,
    64,
    { N: 16384, r: 8, p: 1 }
  );

  return {
    pinSalt: salt.toString("base64"),
    pinHash: hash.toString("base64")
  };
}

function verifyPin(account, pin) {
  if (
    !account?.pinSalt ||
    !account?.pinHash ||
    !validPin(pin)
  ) {
    return false;
  }

  const salt = Buffer.from(account.pinSalt, "base64");
  const expected = Buffer.from(account.pinHash, "base64");
  const actual = crypto.scryptSync(
    String(pin),
    salt,
    64,
    { N: 16384, r: 8, p: 1 }
  );

  return expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual);
}

function clientAddress(req) {
  return String(
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "unknown"
  )
    .split(",")[0]
    .trim();
}

function attemptKey(req, username) {
  return `${clientAddress(req)}:${usernameKey(username)}`;
}

function checkRateLimit(req, username) {
  const key = attemptKey(req, username);
  const state = loginAttempts.get(key);

  if (!state) return null;

  if (state.lockUntil && state.lockUntil > Date.now()) {
    return Math.ceil((state.lockUntil - Date.now()) / 1000);
  }

  if (state.lockUntil && state.lockUntil <= Date.now()) {
    loginAttempts.delete(key);
  }

  return null;
}

function registerFailedLogin(req, username) {
  const key = attemptKey(req, username);
  const now = Date.now();

  const state = loginAttempts.get(key) || {
    count: 0,
    firstAt: now,
    lockUntil: 0
  };

  if (now - state.firstAt > 10 * 60 * 1000) {
    state.count = 0;
    state.firstAt = now;
  }

  state.count += 1;

  if (state.count >= 5) {
    state.lockUntil = now + 10 * 60 * 1000;
  }

  loginAttempts.set(key, state);
}

function clearFailedLogins(req, username) {
  loginAttempts.delete(attemptKey(req, username));
}

function safeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function mapStaffRow(row) {
  if (!row) return null;

  return {
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    pinSalt: row.pin_salt,
    pinHash: row.pin_hash,
    enabled: row.enabled,
    visible: row.visible,
    order: Number(row.display_order || 100),
    permissions:
      row.role === "Owner"
        ? [...ALL_PERMISSIONS]
        : (row.permissions || []).filter(
            permission => ALL_PERMISSIONS.includes(permission)
          )
  };
}

async function getStaffAccount(username) {
  const result = await query(
    `
      select
        u.*,
        coalesce(
          array_agg(p.permission)
            filter (where p.permission is not null),
          '{}'::text[]
        ) as permissions
      from public.staff_users u
      left join public.staff_permissions p
        on p.username_key = u.username_key
      where u.username_key = $1
      group by u.username_key
    `,
    [usernameKey(username)]
  );

  return mapStaffRow(result.rows[0]);
}

async function listPublicStaff() {
  const result = await query(
    `
      select
        username,
        display_name,
        role,
        visible,
        display_order,
        updated_at
      from public.staff_users
      where visible = true
        and enabled = true
      order by display_order asc, display_name asc
    `
  );

  return {
    members: result.rows.map(row => ({
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      visible: row.visible,
      order: Number(row.display_order || 100)
    })),
    updatedAt:
      result.rows.length
        ? result.rows
            .map(row => row.updated_at)
            .filter(Boolean)
            .sort()
            .at(-1) || null
        : null
  };
}

async function listAllStaff() {
  const result = await query(
    `
      select
        u.*,
        coalesce(
          array_agg(p.permission)
            filter (where p.permission is not null),
          '{}'::text[]
        ) as permissions
      from public.staff_users u
      left join public.staff_permissions p
        on p.username_key = u.username_key
      group by u.username_key
      order by u.display_order asc, u.display_name asc
    `
  );

  return result.rows.map(row => {
    const member = mapStaffRow(row);

    return {
      username: member.username,
      displayName: member.displayName,
      role: member.role,
      visible: member.visible,
      order: member.order,
      permissions: member.permissions,
      enabled: member.enabled
    };
  });
}

async function getWikiData(client = null) {
  const q = client
    ? (text, params) => client.query(text, params)
    : query;

  const [categoryResult, pageResult] = await Promise.all([
    q(
      `
        select name
        from public.wiki_categories
        order by display_order asc, name asc
      `
    ),
    q(
      `
        select
          id,
          category_name,
          title,
          description,
          content,
          updated_by,
          updated_at
        from public.wiki_pages
        order by created_at asc, id asc
      `
    )
  ]);

  const pages = pageResult.rows.map(row => ({
    id: row.id,
    category: row.category_name,
    title: row.title,
    description: row.description,
    content: row.content
  }));

  const timestamps = pageResult.rows
    .map(row => row.updated_at)
    .filter(Boolean)
    .sort();

  const last = pageResult.rows
    .filter(row => row.updated_at)
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
    .at(-1);

  return {
    categories: categoryResult.rows.map(row => row.name),
    pages,
    updatedAt: timestamps.at(-1) || null,
    updatedBy: last?.updated_by || null
  };
}

async function getWikiDrafts() {
  const result = await query(
    `
      select
        id,
        category_name,
        title,
        description,
        content,
        edited_by,
        saved_at
      from public.wiki_drafts
      order by saved_at desc
    `
  );

  const drafts = {};

  for (const row of result.rows) {
    drafts[row.id] = {
      id: row.id,
      category: row.category_name,
      title: row.title,
      description: row.description,
      content: row.content,
      editedBy: row.edited_by,
      savedAt: row.saved_at
    };
  }

  return drafts;
}

async function audit(
  db,
  actorUsername,
  action,
  targetType,
  targetId = null,
  details = {}
) {
  await db.query(
    `
      insert into public.audit_logs(
        actor_username,
        action,
        target_type,
        target_id,
        details
      )
      values ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      actorUsername,
      action,
      targetType,
      targetId,
      JSON.stringify(details || {})
    ]
  );
}

async function handleApi(req, res, url) {
  // ---------------- HEALTH ----------------
  if (req.method === "GET" && url.pathname === "/api/health") {
    try {
      const db = await testConnection();

      return sendJson(res, 200, {
        ok: true,
        database: "connected",
        serverTime: db.server_time
      });
    } catch (error) {
      console.error("[Database] Health check failed:", error);

      return sendJson(res, 503, {
        ok: false,
        database: "unavailable"
      });
    }
  }

  // ---------------- AUTH ----------------
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const session = getSession(req);

    return sendJson(res, 200, {
      loggedIn: !!session,
      user: session ? sanitizeUser(session.user) : null
    });
  }

  if (
    req.method === "GET" &&
    url.pathname === "/api/auth/staff-check"
  ) {
    const username = normalizeUsername(
      url.searchParams.get("username")
    );

    if (!validUsername(username)) {
      return sendJson(res, 200, {
        requiresPin: false
      });
    }

    const account = await getStaffAccount(username);

    return sendJson(res, 200, {
      requiresPin: !!account?.enabled,
      role: account?.enabled ? account.role : null
    });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/login"
  ) {
    try {
      const body = await readBody(req);
      const username = normalizeUsername(body.username);

      if (!validUsername(username)) {
        return sendJson(res, 400, {
          error: "Enter a valid Minecraft username."
        });
      }

      const account = await getStaffAccount(username);

      if (account?.enabled) {
        const wait = checkRateLimit(req, username);

        if (wait) {
          return sendJson(res, 429, {
            error:
              `Too many failed PIN attempts. Try again in ${wait}s.`
          });
        }

        if (!validPin(body.pin)) {
          return sendJson(res, 401, {
            error: "Staff accounts require an 8-digit PIN.",
            requiresPin: true
          });
        }

        if (!verifyPin(account, body.pin)) {
          registerFailedLogin(req, username);

          return sendJson(res, 401, {
            error: "Incorrect staff PIN.",
            requiresPin: true
          });
        }

        clearFailedLogins(req, username);

        const user = {
          username: account.username,
          displayName: account.displayName,
          role: account.role,
          staff: true,
          permissions: account.permissions
        };

        const token = createSession(user);

        return sendJson(
          res,
          200,
          {
            ok: true,
            user: sanitizeUser(user)
          },
          {
            "Set-Cookie": sessionCookie(token)
          }
        );
      }

      // Player website sessions are intentionally username-only.
      // They have no database-backed staff privileges.
      const user = {
        username,
        displayName: username,
        role: "Player",
        staff: false,
        permissions: []
      };

      const token = createSession(user);

      return sendJson(
        res,
        200,
        {
          ok: true,
          user
        },
        {
          "Set-Cookie": sessionCookie(token)
        }
      );
    } catch (error) {
      console.error("[Auth] Login error:", error);
      return sendJson(res, 400, {
        error: "Could not sign in."
      });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/logout"
  ) {
    return sendJson(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": sessionCookie("", 0)
      }
    );
  }

  // ---------------- PUBLIC STAFF ----------------
  if (
    req.method === "GET" &&
    url.pathname === "/api/staff"
  ) {
    return sendJson(
      res,
      200,
      await listPublicStaff()
    );
  }

  // ---------------- CONTROL PANEL ----------------
  if (
    req.method === "GET" &&
    url.pathname === "/api/control/staff"
  ) {
    const session = getSession(req);

    if (
      !session ||
      !(
        hasPermission(session.user, "access_control") ||
        hasPermission(session.user, "edit_staff") ||
        hasPermission(session.user, "manage_access")
      )
    ) {
      return sendJson(res, 403, {
        error: "Control Panel access required."
      });
    }

    return sendJson(res, 200, {
      members: await listAllStaff(),
      availablePermissions: ALL_PERMISSIONS,
      viewer: sanitizeUser(session.user)
    });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/control/staff"
  ) {
    const session = getSession(req);

    if (!session) {
      return sendJson(res, 403, {
        error: "Sign in required."
      });
    }

    try {
      const body = await readBody(req);
      const username = normalizeUsername(body.username);

      if (!validUsername(username)) {
        return sendJson(res, 400, {
          error: "Invalid Minecraft username."
        });
      }

      const canManageAccess =
        hasPermission(session.user, "manage_access");

      const canEditStaff =
        hasPermission(session.user, "edit_staff") ||
        canManageAccess;

      if (!canEditStaff) {
        return sendJson(res, 403, {
          error: "You cannot edit staff members."
        });
      }

      const key = usernameKey(username);
      const existing = await getStaffAccount(username);

      if (!existing && !canManageAccess) {
        return sendJson(res, 403, {
          error: "Only access managers can add staff accounts."
        });
      }

      const result = await withTransaction(async db => {
        let account = existing
          ? { ...existing }
          : {
              username,
              displayName: username,
              role: "Helper",
              pinSalt: null,
              pinHash: null,
              enabled: true,
              visible: true,
              order: 100,
              permissions: []
            };

        account.username = existing?.username || username;

        account.displayName =
          String(
            body.displayName ||
            account.displayName ||
            username
          )
            .trim()
            .slice(0, 32);

        account.visible = body.visible !== false;

        const parsedOrder = Number(body.order);
        account.order =
          Number.isFinite(parsedOrder)
            ? Math.max(0, Math.min(9999, parsedOrder))
            : account.order;

        if (canManageAccess) {
          const role = String(
            body.role ||
            account.role ||
            "Helper"
          );

          account.role =
            ALLOWED_ROLES.includes(role)
              ? role
              : "Helper";

          account.enabled = body.enabled !== false;

          account.permissions =
            account.role === "Owner"
              ? [...ALL_PERMISSIONS]
              : Array.isArray(body.permissions)
                ? body.permissions.filter(
                    permission =>
                      ALL_PERMISSIONS.includes(permission)
                  )
                : [];

          const pin = String(body.pin || "");

          if (!existing && !validPin(pin)) {
            const error = new Error(
              "New staff accounts require an 8-digit PIN."
            );
            error.statusCode = 400;
            throw error;
          }

          if (pin) {
            if (!validPin(pin)) {
              const error = new Error(
                "PIN must contain exactly 8 numbers."
              );
              error.statusCode = 400;
              throw error;
            }

            Object.assign(account, hashPin(pin));
          }
        }

        if (!account.pinSalt || !account.pinHash) {
          const error = new Error(
            "Staff account is missing a PIN."
          );
          error.statusCode = 400;
          throw error;
        }

        await db.query(
          `
            insert into public.staff_users(
              username_key,
              username,
              display_name,
              role,
              pin_salt,
              pin_hash,
              enabled,
              visible,
              display_order,
              updated_at
            )
            values(
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9, now()
            )
            on conflict (username_key)
            do update set
              username = excluded.username,
              display_name = excluded.display_name,
              role = excluded.role,
              pin_salt = excluded.pin_salt,
              pin_hash = excluded.pin_hash,
              enabled = excluded.enabled,
              visible = excluded.visible,
              display_order = excluded.display_order,
              updated_at = now()
          `,
          [
            key,
            account.username,
            account.displayName,
            account.role,
            account.pinSalt,
            account.pinHash,
            account.enabled,
            account.visible,
            account.order
          ]
        );

        if (canManageAccess) {
          await db.query(
            `
              delete from public.staff_permissions
              where username_key = $1
            `,
            [key]
          );

          for (const permission of account.permissions) {
            await db.query(
              `
                insert into public.staff_permissions(
                  username_key,
                  permission
                )
                values($1, $2)
                on conflict do nothing
              `,
              [key, permission]
            );
          }
        }

        await audit(
          db,
          session.user.username,
          existing ? "staff.updated" : "staff.created",
          "staff",
          account.username,
          {
            role: account.role,
            visible: account.visible,
            order: account.order,
            permissions: account.permissions
          }
        );

        return account;
      });

      return sendJson(res, 200, {
        ok: true,
        member: {
          username: result.username,
          displayName: result.displayName,
          role: result.role,
          visible: result.visible,
          order: result.order,
          permissions: result.permissions,
          enabled: result.enabled
        }
      });
    } catch (error) {
      console.error("[Staff] Save failed:", error);

      return sendJson(
        res,
        error.statusCode || 400,
        {
          error:
            error.statusCode
              ? error.message
              : "Could not save staff member."
        }
      );
    }
  }

  if (
    req.method === "DELETE" &&
    url.pathname.startsWith("/api/control/staff/")
  ) {
    const session = requirePermission(
      req,
      res,
      "manage_access"
    );

    if (!session) return;

    const username =
      decodeURIComponent(
        url.pathname.split("/").pop()
      );

    const key = usernameKey(username);

    if (key === usernameKey(session.user.username)) {
      return sendJson(res, 400, {
        error: "You cannot remove your own staff account."
      });
    }

    const account = await getStaffAccount(username);

    if (!account) {
      return sendJson(res, 404, {
        error: "Staff member not found."
      });
    }

    if (account.role === "Owner") {
      const ownerResult = await query(
        `
          select count(*)::integer as count
          from public.staff_users
          where role = 'Owner'
            and enabled = true
        `
      );

      if (ownerResult.rows[0].count <= 1) {
        return sendJson(res, 400, {
          error: "The last Owner account cannot be removed."
        });
      }
    }

    await withTransaction(async db => {
      await db.query(
        `
          delete from public.staff_users
          where username_key = $1
        `,
        [key]
      );

      await audit(
        db,
        session.user.username,
        "staff.deleted",
        "staff",
        account.username,
        {
          role: account.role
        }
      );
    });

    return sendJson(res, 200, {
      ok: true
    });
  }

  if (
    req.method === "GET" &&
    url.pathname === "/api/control/audit"
  ) {
    const session = getSession(req);

    if (
      !session ||
      !(
        hasPermission(session.user, "access_control") ||
        hasPermission(session.user, "manage_access")
      )
    ) {
      return sendJson(res, 403, {
        error: "Control Panel access required."
      });
    }

    const result = await query(
      `
        select
          id,
          actor_username,
          action,
          target_type,
          target_id,
          details,
          created_at
        from public.audit_logs
        order by created_at desc
        limit 100
      `
    );

    return sendJson(res, 200, {
      entries: result.rows.map(row => ({
        id: row.id,
        actor: row.actor_username,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: row.details,
        createdAt: row.created_at
      }))
    });
  }

  // ---------------- WIKI ----------------
  if (
    req.method === "GET" &&
    url.pathname === "/api/wiki"
  ) {
    return sendJson(
      res,
      200,
      await getWikiData()
    );
  }

  if (
    req.method === "GET" &&
    url.pathname === "/api/wiki/editor"
  ) {
    if (!requirePermission(req, res, "edit_wiki")) {
      return;
    }

    const [published, drafts] = await Promise.all([
      getWikiData(),
      getWikiDrafts()
    ]);

    return sendJson(res, 200, {
      published,
      drafts
    });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/wiki/draft"
  ) {
    const session = requirePermission(
      req,
      res,
      "edit_wiki"
    );

    if (!session) return;

    try {
      const body = await readBody(req);
      const id = safeId(body.id);

      if (!id) {
        return sendJson(res, 400, {
          error: "Missing page id."
        });
      }

      const draft = {
        id,
        category:
          String(body.category || "General").trim() ||
          "General",
        title:
          String(body.title || "Untitled").trim() ||
          "Untitled",
        description:
          String(body.description || "").trim(),
        content: String(body.content || "")
      };

      await withTransaction(async db => {
        await db.query(
          `
            insert into public.wiki_drafts(
              id,
              category_name,
              title,
              description,
              content,
              edited_by,
              saved_at
            )
            values($1, $2, $3, $4, $5, $6, now())
            on conflict (id)
            do update set
              category_name = excluded.category_name,
              title = excluded.title,
              description = excluded.description,
              content = excluded.content,
              edited_by = excluded.edited_by,
              saved_at = now()
          `,
          [
            draft.id,
            draft.category,
            draft.title,
            draft.description,
            draft.content,
            session.user.username
          ]
        );

        await audit(
          db,
          session.user.username,
          "wiki.draft_saved",
          "wiki_page",
          draft.id,
          {
            title: draft.title,
            category: draft.category
          }
        );
      });

      return sendJson(res, 200, {
        ok: true,
        draft: {
          ...draft,
          editedBy: session.user.username,
          savedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error("[Wiki] Draft save failed:", error);

      return sendJson(res, 400, {
        error: "Could not save draft."
      });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/wiki/publish"
  ) {
    const session = requirePermission(
      req,
      res,
      "edit_wiki"
    );

    if (!session) return;

    try {
      const body = await readBody(req);
      const id = safeId(body.id);

      if (!id) {
        return sendJson(res, 400, {
          error: "Missing page id."
        });
      }

      const page = {
        id,
        category:
          String(body.category || "General").trim() ||
          "General",
        title:
          String(body.title || "Untitled").trim() ||
          "Untitled",
        description:
          String(body.description || "").trim(),
        content: String(body.content || "")
      };

      const wiki = await withTransaction(async db => {
        await db.query(
          `
            insert into public.wiki_categories(
              name,
              display_order
            )
            values(
              $1,
              coalesce(
                (
                  select max(display_order) + 10
                  from public.wiki_categories
                ),
                0
              )
            )
            on conflict (name) do nothing
          `,
          [page.category]
        );

        await db.query(
          `
            insert into public.wiki_pages(
              id,
              category_name,
              title,
              description,
              content,
              updated_by,
              updated_at
            )
            values($1, $2, $3, $4, $5, $6, now())
            on conflict (id)
            do update set
              category_name = excluded.category_name,
              title = excluded.title,
              description = excluded.description,
              content = excluded.content,
              updated_by = excluded.updated_by,
              updated_at = now()
          `,
          [
            page.id,
            page.category,
            page.title,
            page.description,
            page.content,
            session.user.username
          ]
        );

        await db.query(
          `
            delete from public.wiki_drafts
            where id = $1
          `,
          [page.id]
        );

        await audit(
          db,
          session.user.username,
          "wiki.published",
          "wiki_page",
          page.id,
          {
            title: page.title,
            category: page.category
          }
        );

        return getWikiData(db);
      });

      return sendJson(res, 200, {
        ok: true,
        page,
        wiki
      });
    } catch (error) {
      console.error("[Wiki] Publish failed:", error);

      return sendJson(res, 400, {
        error: "Could not publish page."
      });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/wiki/categories"
  ) {
    const session = requirePermission(
      req,
      res,
      "edit_wiki"
    );

    if (!session) return;

    try {
      const body = await readBody(req);
      const action = String(body.action || "");

      const wiki = await withTransaction(async db => {
        if (action === "add") {
          const name = String(body.name || "").trim();

          if (!name) {
            const error = new Error(
              "Category name required."
            );
            error.statusCode = 400;
            throw error;
          }

          await db.query(
            `
              insert into public.wiki_categories(
                name,
                display_order
              )
              values(
                $1,
                coalesce(
                  (
                    select max(display_order) + 10
                    from public.wiki_categories
                  ),
                  0
                )
              )
              on conflict (name) do nothing
            `,
            [name]
          );

          await audit(
            db,
            session.user.username,
            "wiki.category_added",
            "wiki_category",
            name
          );
        } else if (action === "rename") {
          const from = String(body.from || "").trim();
          const to = String(body.to || "").trim();

          if (!from || !to) {
            const error = new Error(
              "Both category names are required."
            );
            error.statusCode = 400;
            throw error;
          }

          await db.query(
            `
              insert into public.wiki_categories(
                name,
                display_order
              )
              select $2, display_order
              from public.wiki_categories
              where name = $1
              on conflict (name) do nothing
            `,
            [from, to]
          );

          await db.query(
            `
              update public.wiki_pages
              set category_name = $2
              where category_name = $1
            `,
            [from, to]
          );

          await db.query(
            `
              update public.wiki_drafts
              set category_name = $2
              where category_name = $1
            `,
            [from, to]
          );

          if (from !== to) {
            await db.query(
              `
                delete from public.wiki_categories
                where name = $1
              `,
              [from]
            );
          }

          await audit(
            db,
            session.user.username,
            "wiki.category_renamed",
            "wiki_category",
            from,
            { to }
          );
        } else if (action === "delete") {
          const name = String(body.name || "").trim();

          const replacement =
            String(body.replacement || "General").trim() ||
            "General";

          if (!name) {
            const error = new Error(
              "Category name required."
            );
            error.statusCode = 400;
            throw error;
          }

          await db.query(
            `
              insert into public.wiki_categories(
                name,
                display_order
              )
              values($1, 0)
              on conflict (name) do nothing
            `,
            [replacement]
          );

          await db.query(
            `
              update public.wiki_pages
              set category_name = $2
              where category_name = $1
            `,
            [name, replacement]
          );

          await db.query(
            `
              update public.wiki_drafts
              set category_name = $2
              where category_name = $1
            `,
            [name, replacement]
          );

          if (name !== replacement) {
            await db.query(
              `
                delete from public.wiki_categories
                where name = $1
              `,
              [name]
            );
          }

          await audit(
            db,
            session.user.username,
            "wiki.category_deleted",
            "wiki_category",
            name,
            { replacement }
          );
        } else {
          const error = new Error(
            "Unknown category action."
          );
          error.statusCode = 400;
          throw error;
        }

        return getWikiData(db);
      });

      return sendJson(res, 200, {
        ok: true,
        wiki
      });
    } catch (error) {
      console.error("[Wiki] Category update failed:", error);

      return sendJson(
        res,
        error.statusCode || 400,
        {
          error:
            error.statusCode
              ? error.message
              : "Could not update categories."
        }
      );
    }
  }

  if (
    req.method === "DELETE" &&
    url.pathname.startsWith("/api/wiki/page/")
  ) {
    const session = requirePermission(
      req,
      res,
      "edit_wiki"
    );

    if (!session) return;

    const id = safeId(
      decodeURIComponent(
        url.pathname.split("/").pop()
      )
    );

    const wiki = await withTransaction(async db => {
      await db.query(
        `
          delete from public.wiki_drafts
          where id = $1
        `,
        [id]
      );

      await db.query(
        `
          delete from public.wiki_pages
          where id = $1
        `,
        [id]
      );

      await audit(
        db,
        session.user.username,
        "wiki.deleted",
        "wiki_page",
        id
      );

      return getWikiData(db);
    });

    return sendJson(res, 200, {
      ok: true,
      wiki
    });
  }

  return sendJson(res, 404, {
    error: "API route not found."
  });
}


class PagesResponse {
  constructor() {
    this.status = 200;
    this.headers = new Headers();
    this.body = "";
    this.headersSent = false;
  }
  writeHead(status, headers = {}) {
    this.status = status;
    for (const [key, value] of Object.entries(headers)) {
      this.headers.set(key, String(value));
    }
    this.headersSent = true;
  }
  end(value = "") {
    if (value !== undefined && value !== null) this.body += String(value);
    this.headersSent = true;
  }
  toResponse() {
    return new Response(this.body, { status: this.status, headers: this.headers });
  }
}

function makeNodeLikeRequest(request) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key.toLowerCase()] = value;
  }
  return {
    method: request.method,
    headers,
    socket: { remoteAddress: headers["cf-connecting-ip"] || "unknown" },
    _cfRequest: request
  };
}

export async function onRequest(context) {
  if (!context.env.HYPERDRIVE?.connectionString) {
    return Response.json(
      {
        error:
          "Database binding missing. Add a Hyperdrive binding named HYPERDRIVE."
      },
      { status: 503 }
    );
  }

  if (
    !context.env.SESSION_SECRET ||
    String(context.env.SESSION_SECRET).length < 32
  ) {
    return Response.json(
      {
        error: "SESSION_SECRET is missing or too short."
      },
      { status: 503 }
    );
  }

  const client = new Client({
    connectionString: context.env.HYPERDRIVE.connectionString
  });

  try {
    await client.connect();

    return await requestContext.run(
      {
        client,
        env: context.env
      },
      async () => {
        const req = makeNodeLikeRequest(context.request);
        const res = new PagesResponse();
        const url = new URL(context.request.url);

        /*
         * This file lives at functions/api/[[path]].js.
         *
         * Cloudflare exposes the part matched by [[path]] through
         * context.params.path. For example:
         *
         *   /api/health      -> ["health"]
         *   /api/auth/me     -> ["auth", "me"]
         *   /api/wiki/editor -> ["wiki", "editor"]
         *
         * Build the internal API pathname from that instead of relying on
         * request.url pathname/rewrite behavior.
         */
        const rawPath = context.params?.path;

        let parts = [];

        if (Array.isArray(rawPath)) {
          parts = rawPath;
        } else if (typeof rawPath === "string" && rawPath) {
          parts = rawPath.split("/");
        }

        parts = parts
          .map(part => String(part || "").trim())
          .filter(Boolean);

        url.pathname =
          parts.length > 0
            ? `/api/${parts.join("/")}`
            : "/api";

        // Normalize an accidental trailing slash.
        if (
          url.pathname.length > 1 &&
          url.pathname.endsWith("/")
        ) {
          url.pathname = url.pathname.slice(0, -1);
        }

        console.log(
          `[API] method=${context.request.method} ` +
          `request=${new URL(context.request.url).pathname} ` +
          `functionPath=${context.functionPath || ""} ` +
          `params=${JSON.stringify(context.params || {})} ` +
          `resolved=${url.pathname}`
        );

        try {
          await handleApi(req, res, url);
        } catch (error) {
          console.error("[API] Unhandled request error:", error);

          if (!res.headersSent) {
            sendJson(res, 500, {
              error: "Internal server error."
            });
          }
        }

        return res.toResponse();
      }
    );
  } catch (error) {
    console.error("[API] Database connection failed:", error);

    return Response.json(
      {
        error: "Database connection failed."
      },
      { status: 503 }
    );
  } finally {
    await client.end().catch(() => {});
  }
}

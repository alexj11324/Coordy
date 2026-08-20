import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
  type JsonWebKey as CryptoJsonWebKey,
} from "crypto";
import type { SanitizedAuthState } from "../shared/auth-bridge";

export type ClerkOAuthConfig = {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
};

export type StoredOAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  identity: NonNullable<SanitizedAuthState["identity"]>;
  organization: SanitizedAuthState["organization"];
};

export interface OAuthSessionStore {
  load(): Promise<StoredOAuthSession | null>;
  save(session: StoredOAuthSession): Promise<void>;
  clear(): Promise<void>;
}

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
};

type PendingAuthorization = {
  state: string;
  nonce: string;
  verifier: string;
};

type UserInfo = {
  sub?: unknown;
  user_id?: unknown;
  name?: unknown;
  email?: unknown;
  picture?: unknown;
  org_id?: unknown;
  org_name?: unknown;
};

const REFRESH_EARLY_MS = 60_000;

export class ClerkOAuthClient {
  private discovery: Discovery | null = null;
  private pending: PendingAuthorization | null = null;

  constructor(
    private readonly config: ClerkOAuthConfig,
    private readonly store: OAuthSessionStore,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly random: (bytes: number) => Buffer = randomBytes,
  ) {
    validateConfig(config);
  }

  async restore(): Promise<SanitizedAuthState> {
    const stored = await this.store.load();
    if (!stored) return signedOut();
    try {
      if (stored.expiresAt > this.now() + REFRESH_EARLY_MS) {
        return stateFromSession(stored);
      }
      return stateFromSession(await this.refresh(stored));
    } catch {
      await this.store.clear();
      return signedOut();
    }
  }

  async beginAuthorization(forceConsent = false): Promise<string> {
    const discovery = await this.getDiscovery();
    const verifier = base64Url(this.random(48));
    const state = base64Url(this.random(32));
    const nonce = base64Url(this.random(32));
    this.pending = { state, nonce, verifier };
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", this.config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", base64Url(createHash("sha256").update(verifier).digest()));
    url.searchParams.set("code_challenge_method", "S256");
    if (forceConsent) url.searchParams.set("prompt", "consent");
    return url.href;
  }

  async completeAuthorization(callbackUrl: string): Promise<SanitizedAuthState> {
    const pending = this.pending;
    this.pending = null;
    if (!pending) throw new Error("No OAuth authorization is pending");
    const callback = new URL(callbackUrl);
    const expected = new URL(this.config.redirectUri);
    if (
      callback.protocol !== expected.protocol ||
      callback.host !== expected.host ||
      callback.pathname !== expected.pathname ||
      callback.searchParams.get("state") !== pending.state
    ) {
      throw new Error("Invalid OAuth callback");
    }
    const oauthError = callback.searchParams.get("error");
    if (oauthError) throw new Error(`OAuth authorization failed: ${oauthError}`);
    const code = callback.searchParams.get("code");
    if (!code) throw new Error("OAuth callback has no authorization code");
    const discovery = await this.getDiscovery();
    const tokens = await this.tokenRequest(discovery.token_endpoint, {
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code,
      code_verifier: pending.verifier,
    }, true);
    await verifyIdToken(tokens.id_token!, pending.nonce, this.config, discovery, this.request, this.now());
    if (!tokens.refresh_token) throw new Error("Clerk did not return a refresh token");
    const session = await this.createSession(tokens, tokens.refresh_token, discovery);
    await this.store.save(session);
    return stateFromSession(session);
  }

  async signOut(): Promise<void> {
    const stored = await this.store.load();
    await this.store.clear();
    if (!stored) return;
    try {
      const discovery = await this.getDiscovery();
      if (!discovery.revocation_endpoint) return;
      await this.request(discovery.revocation_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: stored.refreshToken,
          token_type_hint: "refresh_token",
          client_id: this.config.clientId,
        }),
      });
    } catch {
      // Local sign-out must still succeed when Clerk is temporarily unreachable.
    }
  }

  private async refresh(stored: StoredOAuthSession): Promise<StoredOAuthSession> {
    const discovery = await this.getDiscovery();
    const tokens = await this.tokenRequest(discovery.token_endpoint, {
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      refresh_token: stored.refreshToken,
    });
    const session = await this.createSession(
      tokens,
      tokens.refresh_token ?? stored.refreshToken,
      discovery,
    );
    await this.store.save(session);
    return session;
  }

  private async createSession(
    tokens: TokenResponse,
    refreshToken: string,
    discovery: Discovery,
  ): Promise<StoredOAuthSession> {
    const response = await this.request(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!response.ok) throw new Error("Clerk user info request failed");
    const userInfo = await response.json() as UserInfo;
    const id = text(userInfo.sub, 128) ?? text(userInfo.user_id, 128);
    if (!id) throw new Error("Clerk user info has no user ID");
    const email = text(userInfo.email, 320);
    const name = text(userInfo.name, 200) ?? email ?? "在线用户";
    const picture = httpsUrl(userInfo.picture, "img.clerk.com");
    const orgId = text(userInfo.org_id, 128);
    const orgName = text(userInfo.org_name, 200);
    return {
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt: this.now() + tokens.expires_in * 1_000,
      identity: { id, name, email, imageUrl: picture },
      organization: orgId && orgName
        ? { id: orgId, name: orgName, imageUrl: null }
        : null,
    };
  }

  private async tokenRequest(
    endpoint: string,
    fields: Record<string, string>,
    requireIdToken = false,
  ): Promise<TokenResponse> {
    const response = await this.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
    if (!response.ok) throw new Error("Clerk token exchange failed");
    const raw = await response.json() as Partial<TokenResponse>;
    if (
      typeof raw.access_token !== "string" ||
      typeof raw.expires_in !== "number" ||
      raw.token_type?.toLowerCase() !== "bearer" ||
      (requireIdToken && typeof raw.id_token !== "string")
    ) {
      throw new Error("Clerk returned an invalid token response");
    }
    return raw as TokenResponse;
  }

  private async getDiscovery(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const url = new URL("/.well-known/oauth-authorization-server", this.config.issuer);
    const response = await this.request(url);
    if (!response.ok) throw new Error("Unable to load Clerk OAuth metadata");
    const raw = await response.json() as Partial<Discovery>;
    const required = [
      raw.authorization_endpoint,
      raw.token_endpoint,
      raw.userinfo_endpoint,
      raw.jwks_uri,
    ];
    if (raw.issuer !== this.config.issuer || required.some((value) => typeof value !== "string")) {
      throw new Error("Invalid Clerk OAuth metadata");
    }
    for (const value of [...required, raw.revocation_endpoint].filter(Boolean) as string[]) {
      const endpoint = new URL(value);
      if (endpoint.protocol !== "https:" || endpoint.origin !== new URL(this.config.issuer).origin) {
        throw new Error("Clerk OAuth metadata contains an untrusted endpoint");
      }
    }
    this.discovery = raw as Discovery;
    return this.discovery;
  }
}

async function verifyIdToken(
  token: string,
  nonce: string,
  config: ClerkOAuthConfig,
  discovery: Discovery,
  request: typeof fetch,
  now: number,
): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Clerk ID token");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>;
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Invalid Clerk ID token header");
  const audience = claims.aud;
  const audienceMatches = audience === config.clientId ||
    (Array.isArray(audience) && audience.includes(config.clientId));
  if (
    claims.iss !== config.issuer ||
    !audienceMatches ||
    claims.nonce !== nonce ||
    typeof claims.exp !== "number" ||
    claims.exp * 1_000 <= now
  ) {
    throw new Error("Invalid Clerk ID token claims");
  }
  const response = await request(discovery.jwks_uri);
  if (!response.ok) throw new Error("Unable to load Clerk signing keys");
  const jwks = await response.json() as { keys?: Array<Record<string, unknown>> };
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA") throw new Error("Clerk signing key not found");
  const key = createPublicKey({ key: jwk as CryptoJsonWebKey, format: "jwk" });
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], "base64url"),
  );
  if (!valid) throw new Error("Invalid Clerk ID token signature");
}

function validateConfig(config: ClerkOAuthConfig): void {
  const issuer = new URL(config.issuer);
  const redirect = new URL(config.redirectUri);
  if (
    issuer.protocol !== "https:" ||
    issuer.pathname !== "/" ||
    redirect.protocol !== "coordy:" ||
    redirect.host !== "oauth" ||
    redirect.pathname !== "/callback" ||
    !config.clientId.trim() ||
    !config.scopes.includes("openid") ||
    !config.scopes.includes("user:org:read")
  ) {
    throw new Error("Invalid Clerk OAuth configuration");
  }
}

function signedOut(): SanitizedAuthState {
  return { status: "signed-out", identity: null, organization: null };
}

function stateFromSession(session: StoredOAuthSession): SanitizedAuthState {
  return {
    status: "signed-in",
    identity: session.identity,
    organization: session.organization,
  };
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

function httpsUrl(value: unknown, expectedHost: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === expectedHost ? url.href : null;
  } catch {
    return null;
  }
}

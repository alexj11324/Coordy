import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import type { OAuthSessionStore, StoredOAuthSession } from "./clerk-oauth";

export interface SecureEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class EncryptedOAuthTokenStore implements OAuthSessionStore {
  constructor(
    private readonly filePath: string,
    private readonly encryption: SecureEncryption,
  ) {}

  async load(): Promise<StoredOAuthSession | null> {
    if (!this.encryption.isEncryptionAvailable()) return null;
    try {
      const encrypted = await readFile(this.filePath);
      const parsed = JSON.parse(this.encryption.decryptString(encrypted)) as unknown;
      return isStoredOAuthSession(parsed) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return null;
    }
  }

  async save(session: StoredOAuthSession): Promise<void> {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error("Secure operating-system credential storage is unavailable");
    }
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(
      temporary,
      this.encryption.encryptString(JSON.stringify(session)),
      { mode: 0o600 },
    );
    await rename(temporary, this.filePath);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function isStoredOAuthSession(value: unknown): value is StoredOAuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StoredOAuthSession>;
  const identity = session.identity;
  const organization = session.organization;
  return typeof session.accessToken === "string" && session.accessToken.length > 0 &&
    typeof session.refreshToken === "string" && session.refreshToken.length > 0 &&
    typeof session.expiresAt === "number" && Number.isFinite(session.expiresAt) &&
    !!identity && typeof identity.id === "string" && identity.id.length > 0 &&
    typeof identity.name === "string" && identity.name.length > 0 &&
    (identity.email === null || typeof identity.email === "string") &&
    (identity.imageUrl === null || typeof identity.imageUrl === "string") &&
    (organization === null || (
      !!organization &&
      typeof organization.id === "string" && organization.id.length > 0 &&
      typeof organization.name === "string" && organization.name.length > 0 &&
      (organization.imageUrl === null || typeof organization.imageUrl === "string")
    ));
}

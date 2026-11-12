import type { Tx } from "@/db/client";
import { platformAdmin } from "@/db/schema";
import { emailField } from "@/lib/validation/auth";
import { hashPassword, validatePassword } from "@/server/auth/password";
import { encryptSecret } from "./crypto";
import { base32Encode, generateTotpSecret, otpauthUri } from "./totp";

/**
 * Creates a platform admin with a password hash and an encrypted TOTP secret. The secret (and
 * its otpauth URI for the authenticator app) is returned once and never stored in the clear;
 * the caller must show it to the person being enrolled. Used by `pnpm admin:create` and tests.
 */
export async function createPlatformAdmin(
  tx: Tx,
  args: { email: string; password: string },
): Promise<{ adminId: string; secret: Buffer; secretBase32: string; uri: string }> {
  const email = emailField.parse(args.email);
  const policy = validatePassword(args.password, [email.split("@")[0] ?? ""]);
  if (!policy.ok) throw new Error(policy.reason);

  const secret = generateTotpSecret();
  const [row] = await tx
    .insert(platformAdmin)
    .values({
      email,
      passwordHash: await hashPassword(args.password),
      totpSecretEnc: encryptSecret(secret),
    })
    .returning({ id: platformAdmin.id });
  return {
    adminId: row!.id,
    secret,
    secretBase32: base32Encode(secret),
    uri: otpauthUri({ email, secret, issuer: "CRM Platform Admin" }),
  };
}

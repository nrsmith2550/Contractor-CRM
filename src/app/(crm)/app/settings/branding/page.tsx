import { LogoUpload } from "@/components/form/LogoUpload";
import { requireUser } from "@/server/auth/http";
import { getLogo } from "@/server/domain/branding";

export default async function BrandingPage() {
  const user = await requireUser();
  return (
    <>
      <h1>Branding</h1>
      <p>Your logo appears at the top of quote PDFs.</p>
      <LogoUpload current={await getLogo(user.tenantId)} />
    </>
  );
}

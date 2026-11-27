import { redirect } from "next/navigation";

/** /settings/organization opens the General tab (keeping ?org= for another organization). */
export default async function OrganizationSettingsIndex({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const org = (await searchParams).org;
  const id = Array.isArray(org) ? org[0] : org;
  redirect(`/settings/organization/general${id && /^[0-9a-f-]{36}$/i.test(id) ? `?org=${id}` : ""}`);
}

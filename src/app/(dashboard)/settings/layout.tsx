import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsTabs } from "@/components/org/settings-tabs";
import { getSession } from "@/lib/analytics/client-context";
import { isPlatformAdmin } from "@/lib/org/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

/** Settings: your own account, your organization and, for platform administrators, the platform. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user, organizations } = await getSession();
  const platform = await isPlatformAdmin(createAdminClient(), user.id);
  const items = [{ href: "/settings", label: "My account", match: "/settings" }];
  if (organizations.length) items.push({ href: "/settings/organization/general", label: "Organization", match: "/settings/organization" });
  if (platform) items.push({ href: "/settings/platform", label: "Platform", match: "/settings/platform" });
  return (
    <div>
      <PageHeader title="Settings" />
      {items.length > 1 && <SettingsTabs items={items} />}
      {children}
    </div>
  );
}

// Internal: deletes a workspace (client) and its data through the same deletion service as the app, e.g. for a
// verified email request. Dry run by default.
//
//   npx tsx --tsconfig tests/tsconfig.test.json --env-file=.env scripts/delete-workspace.mts <clientId>           (shows what would go)
//   npx tsx --tsconfig tests/tsconfig.test.json --env-file=.env scripts/delete-workspace.mts <clientId> --confirm (deletes)
const id = process.argv[2];
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { console.error("Usage: delete-workspace.mts <clientId> [--confirm]"); process.exit(1); }
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();
const { data: client } = await admin.from("clients").select("id, name").eq("id", id).maybeSingle();
if (!client) { console.error("No workspace with that id."); process.exit(1); }
const { data: conns } = await admin.from("integration_connections").select("provider, status").eq("client_id", id);
const { count } = await admin.from("client_members").select("user_id", { count: "exact", head: true }).eq("client_id", id);
console.log(`Workspace "${client.name}": ${conns?.length ?? 0} connections (${(conns ?? []).map((c) => c.provider).join(", ") || "none"}), ${count ?? 0} members.`);
if (!process.argv.includes("--confirm")) { console.log("Dry run. Add --confirm to delete."); process.exit(0); }
const { deleteWorkspace } = await import("@/lib/compliance/deletion");
const r = await deleteWorkspace(admin, id, "email");
console.log(`Deleted: ${r.connections} connections, ${r.users} user logins.`);

import "server-only";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { forgetAll } from "@/lib/memo";

/** next/cache revalidatePath that also clears the short-lived read cache, so a change shows at once. */
export function revalidatePath(...args: Parameters<typeof nextRevalidatePath>) {
  forgetAll();
  return nextRevalidatePath(...args);
}

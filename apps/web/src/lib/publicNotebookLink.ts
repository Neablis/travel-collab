import { apiUrl } from "@/lib/apiClient";

/** `/n/<token>`, absolute, which is what is copied and sent (M58). */
export function publicNotebookLink(token: string): string {
  return apiUrl(`/n/${encodeURIComponent(token)}`);
}

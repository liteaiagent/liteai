import { base64Encode } from "@liteai/util/encode"

/** Map directory path -> projectID for SDK API calls */
export function toProjectID(directory: string): string {
  return base64Encode(directory)
}

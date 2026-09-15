export function redactGitLabSecrets(message: string, token?: string): string {
  let out = message;
  if (token && token.length > 4) {
    out = out.split(token).join("***");
  }
  out = out.replace(/PRIVATE-TOKEN:\s*\S+/gi, "PRIVATE-TOKEN: ***");
  out = out.replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer ***");
  out = out.replace(/(-H\s+PRIVATE-TOKEN:\s*)\S+/gi, "$1***");
  return out;
}

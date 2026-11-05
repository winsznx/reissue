import { credentialsPath, registerOnce } from "@reissue/workflows";

const creds = await registerOnce();
console.log(`Coordinator agent "${creds.name}" registered as ${creds.agentId}.`);
console.log(`Credentials stored at ${credentialsPath()} (mode 600, git-ignored). The API key is not printed.`);

import type { SecretProvider } from "../azure/index.js";
import type { CreativeListingCredentials, CredentialProvider } from "./types.js";

export class KeyVaultCredentialProvider implements CredentialProvider {
  public constructor(
    private readonly secrets: SecretProvider,
    private readonly usernameSecretName: string,
    private readonly passwordSecretName: string,
  ) {}

  public async getCredentials(): Promise<CreativeListingCredentials> {
    const [username, password] = await Promise.all([
      this.secrets.getSecret(this.usernameSecretName),
      this.secrets.getSecret(this.passwordSecretName),
    ]);
    return { username, password };
  }
}

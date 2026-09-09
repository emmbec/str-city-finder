import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

export interface SecretProvider {
  getSecret(name: string): Promise<string>;
}

export class SecretNotFoundError extends Error {
  public constructor(secretName: string) {
    super(`The requested secret '${secretName}' was not found or has no value.`);
    this.name = "SecretNotFoundError";
  }
}

export class AzureKeyVaultSecretProvider implements SecretProvider {
  private readonly client: SecretClient;

  public constructor(vaultUrl: string, credential: TokenCredential = new DefaultAzureCredential()) {
    this.client = new SecretClient(vaultUrl, credential);
  }

  public async getSecret(name: string): Promise<string> {
    const secret = await this.client.getSecret(name);
    if (secret.value === undefined || secret.value.length === 0) {
      throw new SecretNotFoundError(name);
    }
    return secret.value;
  }
}

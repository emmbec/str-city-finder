import { DefaultAzureCredential, type TokenCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

export interface BlobArtifactStore {
  put(blobName: string, content: Uint8Array | string, contentType: string): Promise<string>;
  get(blobName: string): Promise<Uint8Array | undefined>;
}

export class AzureBlobArtifactStore implements BlobArtifactStore {
  private readonly client;

  public constructor(
    serviceUrl: string,
    containerName: string,
    credential: TokenCredential = new DefaultAzureCredential(),
  ) {
    this.client = new BlobServiceClient(serviceUrl, credential).getContainerClient(containerName);
  }

  public async put(blobName: string, content: Uint8Array | string, contentType: string): Promise<string> {
    const blob = this.client.getBlockBlobClient(blobName);
    await blob.uploadData(typeof content === "string" ? Buffer.from(content, "utf8") : content, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return blob.url;
  }

  public async get(blobName: string): Promise<Uint8Array | undefined> {
    const blob = this.client.getBlockBlobClient(blobName);
    if (!(await blob.exists())) return undefined;
    const response = await blob.downloadToBuffer();
    return new Uint8Array(response);
  }
}

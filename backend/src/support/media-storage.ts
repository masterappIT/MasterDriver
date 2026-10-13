import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { AppConfig } from '../config';

/**
 * Private storage for 客服 pictures and videos. Nothing in it is ever public:
 * the API reads a file back only after checking who is asking.
 */
export interface MediaStorage {
  /** False when no storage is configured; uploads are then refused and text still works. */
  readonly available: boolean;
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  /** Null when the file is not there (never stored, or already removed). */
  read(key: string): Promise<Buffer | null>;
  /** Removing a file that is not there is not an error. */
  remove(key: string): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/** Keys are made by the API (`support/<conversation>/<media>.<ext>`); anything else is a bug. */
const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.[a-z0-9]+$/;
function checkKey(key: string) {
  if (!KEY.test(key)) throw new Error('Invalid media storage key');
}

/** Local development and tests: files under one directory. */
export class LocalMediaStorage implements MediaStorage {
  readonly available = true;
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  private path(key: string) {
    checkKey(key);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid media storage key');
    return path;
  }

  async put(key: string, bytes: Buffer) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async read(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const GCS = 'https://storage.googleapis.com';

/**
 * A private Cloud Storage bucket, through its JSON API. On Cloud Run the
 * service account's access token comes from the metadata server, so there is
 * no key file and no key in the configuration.
 */
export class GcsMediaStorage implements MediaStorage {
  readonly available = true;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly bucket: string,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async accessToken() {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const response = await this.request(METADATA_TOKEN_URL, { headers: { 'metadata-flavor': 'Google' } });
    if (!response.ok) throw new Error(`Cloud Storage access token request failed (${response.status})`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  private object(key: string) {
    checkKey(key);
    return `${GCS}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(key)}`;
  }

  async put(key: string, bytes: Buffer, mime: string) {
    checkKey(key);
    const url = `${GCS}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`;
    const response = await this.request(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': mime },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new Error(`Cloud Storage upload failed (${response.status})`);
  }

  async read(key: string) {
    const response = await this.request(`${this.object(key)}?alt=media`, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Cloud Storage read failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key: string) {
    const response = await this.request(this.object(key), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!response.ok && response.status !== 404) throw new Error(`Cloud Storage delete failed (${response.status})`);
  }
}

/** No storage configured: uploads are refused instead of landing on a disk that will be lost. */
export class UnavailableMediaStorage implements MediaStorage {
  readonly available = false;
  async put(): Promise<void> {
    throw new Error('Media storage is not configured');
  }
  async read() {
    return null;
  }
  async remove() {}
}

export function createMediaStorage(config: Pick<AppConfig, 'isProduction' | 'supportMediaBucket' | 'supportMediaDir'>): MediaStorage {
  if (config.supportMediaBucket) return new GcsMediaStorage(config.supportMediaBucket);
  if (config.isProduction) return new UnavailableMediaStorage();
  return new LocalMediaStorage(config.supportMediaDir ?? resolve(__dirname, '../../../.data/support-media'));
}

import { API_BASE } from '../config/apiConfig';
import { requestJson } from './http';

export type AppleMusicWidevineStatus = {
  ok: boolean;
  status: 'valid' | 'missing' | 'invalid' | 'error';
  details?: string[];
  /**
   * Whose CDM is in use: one uploaded here, or the one the server image was built with.
   * Absent on a core older than 4.0.0-beta.24, which only knows uploads.
   */
  source?: 'uploaded' | 'bundled';
  files?: {
    privateKey: { present: boolean; bytes: number };
    clientId: { present: boolean; bytes: number };
  };
};

export async function fetchAppleMusicWidevineStatus(): Promise<AppleMusicWidevineStatus> {
  return requestJson(`${API_BASE}/applemusic/widevine/status`, {
    errorMessage: 'Failed to fetch Widevine status',
  });
}

export async function uploadAppleMusicWidevinePrivateKey(file: File): Promise<AppleMusicWidevineStatus> {
  return requestJson(`${API_BASE}/applemusic/widevine/private-key`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    errorMessage: 'Failed to upload private_key.pem',
  });
}

export async function uploadAppleMusicWidevineClientId(file: File): Promise<AppleMusicWidevineStatus> {
  return requestJson(`${API_BASE}/applemusic/widevine/client-id`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    errorMessage: 'Failed to upload client_id.bin',
  });
}

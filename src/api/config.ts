import { api, ApiError } from './client';
import type { PublicConfig } from '../config/types';
import defaults from '../config/defaults';

export async function fetchPublicConfig(): Promise<PublicConfig> {
  try {
    return await api.get<PublicConfig>('/api/config/public');
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 503)) {
      return defaults;
    }
    return defaults;
  }
}

import type {
  Activity,
  CreateApplicationInput,
  GrantApplication,
  GrantStage,
  Summary,
  UpdateApplicationInput,
} from '../shared/types';

/**
 * Same-origin API base. Vite proxies `/api` to the Hono API during development and the
 * production server serves the SPA and the API from one origin.
 */
const API_BASE = '/api';

/** Payload accepted by `POST /api/applications`. */
export type ApplicationDraft = CreateApplicationInput;

/** Any valid subset of the editable fields, for `PATCH /api/applications/:id`. */
export type ApplicationPatch = UpdateApplicationInput;

/** Filter values accepted by `GET /api/applications`. */
export interface ApplicationFilters {
  query?: string;
  stage?: GrantStage;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readError(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim().length > 0) {
    return payload.error;
  }
  if (status === 404) return 'That record no longer exists.';
  if (status >= 500) return 'The Grantlane API hit a problem. Please try again.';
  return `The API rejected the request (status ${status}).`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error(
      'Could not reach the Grantlane API. Start the dev server or the production server, then retry.',
    );
  }

  const raw = await response.text();
  let payload: unknown;
  if (raw.trim().length > 0) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    throw new Error(readError(payload, response.status));
  }

  return payload as T;
}

export function fetchSummary(): Promise<Summary> {
  return request<Summary>('/summary');
}

export function fetchApplications(filters: ApplicationFilters = {}): Promise<GrantApplication[]> {
  const params = new URLSearchParams();
  const query = filters.query?.trim();
  if (query) params.set('query', query);
  if (filters.stage) params.set('stage', filters.stage);
  const suffix = params.toString();
  return request<GrantApplication[]>(`/applications${suffix ? `?${suffix}` : ''}`);
}

export function fetchApplication(id: string): Promise<GrantApplication> {
  return request<GrantApplication>(`/applications/${encodeURIComponent(id)}`);
}

export function fetchActivity(limit = 12, applicationId?: string): Promise<Activity[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (applicationId) params.set('applicationId', applicationId);
  return request<Activity[]>(`/activity?${params.toString()}`);
}

export function createApplication(input: ApplicationDraft): Promise<GrantApplication> {
  return request<GrantApplication>('/applications', { method: 'POST', body: input });
}

export function updateApplication(id: string, input: ApplicationPatch): Promise<GrantApplication> {
  return request<GrantApplication>(`/applications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function deleteApplication(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/applications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function addTask(applicationId: string, label: string): Promise<GrantApplication> {
  return request<GrantApplication>(`/applications/${encodeURIComponent(applicationId)}/tasks`, {
    method: 'POST',
    body: { label },
  });
}

export function toggleTask(
  applicationId: string,
  taskId: string,
  done: boolean,
): Promise<GrantApplication> {
  return request<GrantApplication>(
    `/applications/${encodeURIComponent(applicationId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PATCH', body: { done } },
  );
}

export function removeTask(applicationId: string, taskId: string): Promise<GrantApplication> {
  return request<GrantApplication>(
    `/applications/${encodeURIComponent(applicationId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  );
}

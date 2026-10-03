import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/server/app';
import { store } from '../src/server/store';

type GrantStage = 'prospecting' | 'drafting' | 'review' | 'submitted' | 'awarded' | 'declined';

interface Task {
  id: string;
  label: string;
  done: boolean;
}

interface Application {
  id: string;
  title: string;
  funder: string;
  focus: string;
  amount: number;
  deadline: string;
  stage: GrantStage;
  owner: string;
  notes: string;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

interface Summary {
  totalApplications: number;
  activeApplications: number;
  pipelineValue: number;
  awardedValue: number;
  dueSoon: number;
  completionRate: number;
  stageCounts: Record<GrantStage, number>;
}

interface Activity {
  id: string;
  applicationId: string | null;
  applicationTitle: string;
  message: string;
  createdAt: string;
  kind: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function getJson<T>(path: string): Promise<{ response: Response; body: T }> {
  const response = await app.request(path);
  const body = (await response.json()) as T;
  return { response, body };
}

function sendJson(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  );
}

async function expectJsonError(response: Response, status: number): Promise<void> {
  expect(response.status).toBe(status);
  const body = (await response.json()) as { error?: unknown };
  expect(typeof body.error).toBe('string');
}

async function listApplications(): Promise<Application[]> {
  const { response, body } = await getJson<Application[]>('/api/applications');
  expect(response.status).toBe(200);
  expect(Array.isArray(body)).toBe(true);
  return body;
}

function seededApplication(applications: Application[]): Application {
  const [first] = applications;
  if (!first) {
    throw new Error('expected the seeded store to contain at least one application');
  }
  return first;
}

describe('Grantlane API', () => {
  beforeEach(() => {
    store.reset();
  });

  it('reports service health without a database or port', async () => {
    const { response, body } = await getJson<{ ok?: unknown; service?: unknown }>('/api/health');

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, service: 'grantlane' });
  });

  it('summarizes the seeded pipeline consistently with the application list', async () => {
    const applications = await listApplications();
    const { response, body } = await getJson<Summary>('/api/summary');

    expect(response.status).toBe(200);
    expect(applications.length).toBeGreaterThan(0);
    expect(body.totalApplications).toBe(applications.length);
    expect(Object.values(body.stageCounts).reduce((sum, count) => sum + count, 0)).toBe(
      applications.length,
    );
    expect(body.activeApplications).toBeLessThanOrEqual(body.totalApplications);
    expect(body.pipelineValue).toBeGreaterThan(0);
    expect(body.awardedValue).toBeGreaterThanOrEqual(0);
    expect(body.dueSoon).toBeGreaterThanOrEqual(0);
    expect(body.completionRate).toBeGreaterThanOrEqual(0);
    expect(body.completionRate).toBeLessThanOrEqual(1);
  });

  it('lists the seeded applications with unique ids and tasks', async () => {
    const applications = await listApplications();

    expect(applications.length).toBeGreaterThan(0);
    for (const application of applications) {
      expect(application.id).toMatch(/^app-/);
      expect(application.title.length).toBeGreaterThan(0);
      expect(application.funder.length).toBeGreaterThan(0);
      expect(Array.isArray(application.tasks)).toBe(true);
    }
    expect(new Set(applications.map((application) => application.id)).size).toBe(
      applications.length,
    );
  });

  it('searches applications case-insensitively and returns an empty list on no match', async () => {
    const applications = await listApplications();
    const target = seededApplication(applications);
    const term = target.title.split(/\s+/).at(0) ?? target.title;

    const { response, body } = await getJson<Application[]>(
      `/api/applications?query=${encodeURIComponent(term.toUpperCase())}`,
    );

    expect(response.status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((application) => application.id === target.id)).toBe(true);
    for (const application of body) {
      const haystack = [application.title, application.funder, application.focus, application.owner]
        .join(' ')
        .toLowerCase();
      expect(haystack).toContain(term.toLowerCase());
    }

    const miss = await getJson<Application[]>(
      '/api/applications?query=zzz-no-such-grantlane-record',
    );
    expect(miss.response.status).toBe(200);
    expect(miss.body).toEqual([]);
  });

  it('filters applications by stage and rejects an unknown stage', async () => {
    const applications = await listApplications();
    const target = seededApplication(applications);

    const { response, body } = await getJson<Application[]>(
      `/api/applications?stage=${target.stage}`,
    );

    expect(response.status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((application) => application.id === target.id)).toBe(true);
    for (const application of body) {
      expect(application.stage).toBe(target.stage);
    }

    await expectJsonError(await app.request('/api/applications?stage=not-a-real-stage'), 400);
  });

  it('returns an application by id and 404 for an unknown id', async () => {
    const target = seededApplication(await listApplications());
    const { response, body } = await getJson<Application>(`/api/applications/${target.id}`);

    expect(response.status).toBe(200);
    expect(body.id).toBe(target.id);
    expect(body.title).toBe(target.title);
    expect(Array.isArray(body.tasks)).toBe(true);

    await expectJsonError(await app.request('/api/applications/app-does-not-exist'), 404);
  });

  it('creates an application with 201 and rejects an invalid payload with 400', async () => {
    const before = await listApplications();

    const response = await sendJson('POST', '/api/applications', {
      title: 'Riverfront Seed Library',
      funder: 'Greenway Trust',
      focus: 'Community literacy',
      deadline: '2026-12-01',
      amount: 12500,
      owner: 'Nora Fields',
      stage: 'drafting',
      notes: 'Pending board sign-off.',
    });

    expect(response.status).toBe(201);
    const created = (await response.json()) as Application;
    expect(created.id).toMatch(/^app-/);
    expect(created).toMatchObject({
      title: 'Riverfront Seed Library',
      funder: 'Greenway Trust',
      focus: 'Community literacy',
      deadline: '2026-12-01',
      amount: 12500,
      owner: 'Nora Fields',
      stage: 'drafting',
      notes: 'Pending board sign-off.',
    });
    expect(created.tasks).toEqual([]);
    expect(response.headers.get('Location')).toBe(`/api/applications/${created.id}`);

    const after = await listApplications();
    expect(after.length).toBe(before.length + 1);
    expect(after.some((application) => application.id === created.id)).toBe(true);

    const rejected = await sendJson('POST', '/api/applications', {
      funder: 'Missing Title Fund',
      focus: 'Testing',
      deadline: '2026-12-01',
      amount: 1000,
      owner: 'Test Owner',
    });
    await expectJsonError(rejected, 400);
  });

  it('updates an application stage and records stage activity', async () => {
    const target = seededApplication(await listApplications());
    const nextStage: GrantStage = target.stage === 'awarded' ? 'review' : 'awarded';

    const response = await sendJson('PATCH', `/api/applications/${target.id}`, {
      stage: nextStage,
    });

    expect(response.status).toBe(200);
    const updated = (await response.json()) as Application;
    expect(updated.id).toBe(target.id);
    expect(updated.stage).toBe(nextStage);

    const persisted = await getJson<Application>(`/api/applications/${target.id}`);
    expect(persisted.body.stage).toBe(nextStage);

    const activity = await getJson<Activity[]>(`/api/activity?applicationId=${target.id}`);
    expect(activity.response.status).toBe(200);
    const stageEvent = activity.body.find(
      (event) => event.kind === 'stage' && event.message.includes(nextStage),
    );
    expect(stageEvent).toBeDefined();
    expect(stageEvent?.applicationId).toBe(target.id);
    expect(stageEvent?.message).toContain(target.stage);

    await expectJsonError(
      await sendJson('PATCH', '/api/applications/app-does-not-exist', { stage: 'review' }),
      404,
    );
    await expectJsonError(
      await sendJson('PATCH', `/api/applications/${target.id}`, { stage: 'not-a-real-stage' }),
      400,
    );
  });

  it('runs the task lifecycle: add, toggle done, delete, and 404s', async () => {
    const target = seededApplication(await listApplications());

    const added = await sendJson('POST', `/api/applications/${target.id}/tasks`, {
      label: 'Confirm venue insurance',
    });
    expect([200, 201]).toContain(added.status);
    const withTask = (await added.json()) as Application;
    const task = withTask.tasks.find((candidate) => candidate.label === 'Confirm venue insurance');
    expect(task).toBeDefined();
    expect(task?.done).toBe(false);
    const taskId = task?.id ?? 'missing-task-id';

    const toggled = await sendJson('PATCH', `/api/applications/${target.id}/tasks/${taskId}`, {
      done: true,
    });
    expect(toggled.status).toBe(200);
    const toggledApplication = (await toggled.json()) as Application;
    expect(toggledApplication.tasks.find((candidate) => candidate.id === taskId)?.done).toBe(true);

    const removed = await sendJson('DELETE', `/api/applications/${target.id}/tasks/${taskId}`, {});
    expect(removed.status).toBe(200);
    const removedApplication = (await removed.json()) as Application;
    expect(removedApplication.tasks.some((candidate) => candidate.id === taskId)).toBe(false);

    await expectJsonError(
      await sendJson('PATCH', `/api/applications/${target.id}/tasks/task-does-not-exist`, {
        done: true,
      }),
      404,
    );
    await expectJsonError(
      await sendJson('POST', `/api/applications/${target.id}/tasks`, { label: '   ' }),
      400,
    );
    await expectJsonError(
      await sendJson('POST', '/api/applications/app-does-not-exist/tasks', {
        label: 'Orphan task',
      }),
      404,
    );
  });

  it('deletes an application and returns 404 for it afterwards', async () => {
    const before = await listApplications();
    const target = seededApplication(before);

    const response = await sendJson('DELETE', `/api/applications/${target.id}`, {});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });

    const after = await listApplications();
    expect(after.length).toBe(before.length - 1);
    expect(after.some((application) => application.id === target.id)).toBe(false);

    await expectJsonError(await app.request(`/api/applications/${target.id}`), 404);
    await expectJsonError(await app.request(`/api/applications/${target.id}/tasks`), 404);
    await expectJsonError(await sendJson('DELETE', `/api/applications/${target.id}`, {}), 404);
  });
});

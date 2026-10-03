import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  GRANT_STAGES,
  isGrantStage,
  type ActivityFilter,
  type ApplicationFilter,
} from '../shared/types';
import {
  MAX_ACTIVITY_LIMIT,
  store,
  validateCreateInput,
  validateTaskDone,
  validateTaskLabel,
  validateUpdateInput,
  type ValidationResult,
} from './store';

export const app = new Hono();

type JsonBody = { ok: true; value: unknown } | { ok: false };

async function readJsonBody(c: Context): Promise<JsonBody> {
  try {
    const value: unknown = await c.req.json();
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function parseActivityLimit(raw: string | undefined): ValidationResult<number | undefined> {
  if (raw === undefined || raw.trim() === '') {
    return { ok: true, value: undefined };
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) {
    return { ok: false, error: 'limit must be a positive integer' };
  }
  return { ok: true, value: Math.min(limit, MAX_ACTIVITY_LIMIT) };
}

function notFound(c: Context, message: string) {
  return c.json({ error: message }, 404);
}

function badRequest(c: Context, message: string) {
  return c.json({ error: message }, 400);
}

app.get('/api/health', (c) => c.json({ ok: true, service: 'grantlane' }));

app.get('/api/summary', (c) => c.json(store.getSummary()));

app.get('/api/applications', (c) => {
  const rawQuery = c.req.query('query') ?? c.req.query('q') ?? '';
  const rawStage = (c.req.query('stage') ?? '').trim();
  if (rawStage !== '' && !isGrantStage(rawStage)) {
    return badRequest(c, `stage must be one of: ${GRANT_STAGES.join(', ')}`);
  }
  const filter: ApplicationFilter = { query: rawQuery };
  if (isGrantStage(rawStage)) {
    filter.stage = rawStage;
  }
  return c.json(store.listApplications(filter));
});

app.get('/api/applications/:id', (c) => {
  const application = store.getApplication(c.req.param('id'));
  if (!application) {
    return notFound(c, 'Application not found');
  }
  return c.json(application);
});

app.post('/api/applications', async (c) => {
  const body = await readJsonBody(c);
  if (!body.ok) {
    return badRequest(c, 'Invalid JSON body');
  }
  const input = validateCreateInput(body.value);
  if (!input.ok) {
    return badRequest(c, input.error);
  }
  const application = store.createApplication(input.value);
  c.header('Location', `/api/applications/${application.id}`);
  return c.json(application, 201);
});

app.patch('/api/applications/:id', async (c) => {
  const id = c.req.param('id');
  if (!store.getApplication(id)) {
    return notFound(c, 'Application not found');
  }
  const body = await readJsonBody(c);
  if (!body.ok) {
    return badRequest(c, 'Invalid JSON body');
  }
  const patch = validateUpdateInput(body.value);
  if (!patch.ok) {
    return badRequest(c, patch.error);
  }
  const application = store.updateApplication(id, patch.value);
  if (!application) {
    return notFound(c, 'Application not found');
  }
  return c.json(application);
});

app.delete('/api/applications/:id', (c) => {
  const removed = store.deleteApplication(c.req.param('id'));
  if (!removed) {
    return notFound(c, 'Application not found');
  }
  return c.json({ ok: true });
});

app.get('/api/activity', (c) => {
  const limit = parseActivityLimit(c.req.query('limit'));
  if (!limit.ok) {
    return badRequest(c, limit.error);
  }
  const applicationId = c.req.query('applicationId');
  const filter: ActivityFilter = {};
  if (limit.value !== undefined) {
    filter.limit = limit.value;
  }
  if (applicationId !== undefined && applicationId !== '') {
    filter.applicationId = applicationId;
  }
  return c.json(store.listActivity(filter));
});

app.post('/api/applications/:id/tasks', async (c) => {
  const id = c.req.param('id');
  if (!store.getApplication(id)) {
    return notFound(c, 'Application not found');
  }
  const body = await readJsonBody(c);
  if (!body.ok) {
    return badRequest(c, 'Invalid JSON body');
  }
  const label = validateTaskLabel(body.value);
  if (!label.ok) {
    return badRequest(c, label.error);
  }
  const application = store.addTask(id, label.value);
  if (!application) {
    return notFound(c, 'Application not found');
  }
  return c.json(application);
});

app.patch('/api/applications/:id/tasks/:taskId', async (c) => {
  const id = c.req.param('id');
  const taskId = c.req.param('taskId');
  if (!store.getApplication(id)) {
    return notFound(c, 'Application not found');
  }
  const body = await readJsonBody(c);
  if (!body.ok) {
    return badRequest(c, 'Invalid JSON body');
  }
  const done = validateTaskDone(body.value);
  if (!done.ok) {
    return badRequest(c, done.error);
  }
  const application = store.toggleTask(id, taskId, done.value);
  if (!application) {
    return notFound(c, 'Task not found');
  }
  return c.json(application);
});

app.delete('/api/applications/:id/tasks/:taskId', (c) => {
  const id = c.req.param('id');
  const taskId = c.req.param('taskId');
  if (!store.getApplication(id)) {
    return notFound(c, 'Application not found');
  }
  const application = store.deleteTask(id, taskId);
  if (!application) {
    return notFound(c, 'Task not found');
  }
  return c.json(application);
});

app.all('/api', (c) => notFound(c, 'Not found'));
app.all('/api/*', (c) => notFound(c, 'Not found'));

app.notFound((c) => notFound(c, 'Not found'));

app.onError((error, c) => {
  console.error('Grantlane API error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});

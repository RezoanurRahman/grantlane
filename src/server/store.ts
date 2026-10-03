import {
  GRANT_STAGES,
  isGrantStage,
  type Activity,
  type ActivityFilter,
  type ActivityKind,
  type ApplicationFilter,
  type CreateApplicationInput,
  type GrantApplication,
  type GrantStage,
  type GrantTask,
  type Summary,
  type UpdateApplicationInput,
} from '../shared/types';
import { SEED_ACTIVITIES, SEED_APPLICATIONS, SEED_REFERENCE_DATE } from './seed';

export const MAX_ACTIVITY_LIMIT = 100;

const DEFAULT_ACTIVITY_LIMIT = 50;
const DUE_SOON_DAYS = 14;
const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Deterministic clock: seeded timestamps end before this instant. */
const CLOCK_START_MS = Date.UTC(2026, 9, 3, 15, 0, 0);
const CLOCK_STEP_MS = 60_000;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addDays(date: string, days: number): string {
  const start = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(start + days * DAY_MS).toISOString().slice(0, 10);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function readText(record: Record<string, unknown>, field: string): ValidationResult<string> {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: `${field} is required and must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
}

function readAmount(record: Record<string, unknown>): ValidationResult<number> {
  const value = record.amount;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'amount must be a positive number' };
  }
  return { ok: true, value };
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }
  const [yearPart, monthPart, dayPart] = value.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function readDeadline(record: Record<string, unknown>): ValidationResult<string> {
  const value = record.deadline;
  if (!isValidDateString(value)) {
    return { ok: false, error: 'deadline must be a valid date in YYYY-MM-DD format' };
  }
  return { ok: true, value };
}

function readStage(record: Record<string, unknown>): ValidationResult<GrantStage> {
  const value = record.stage;
  if (!isGrantStage(value)) {
    return { ok: false, error: `stage must be one of: ${GRANT_STAGES.join(', ')}` };
  }
  return { ok: true, value };
}

export function validateCreateInput(body: unknown): ValidationResult<CreateApplicationInput> {
  if (!isRecord(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const title = readText(body, 'title');
  if (!title.ok) return title;
  const funder = readText(body, 'funder');
  if (!funder.ok) return funder;
  const focus = readText(body, 'focus');
  if (!focus.ok) return focus;
  const deadline = readDeadline(body);
  if (!deadline.ok) return deadline;
  const amount = readAmount(body);
  if (!amount.ok) return amount;
  const owner = readText(body, 'owner');
  if (!owner.ok) return owner;

  let stage: GrantStage = 'prospecting';
  if (body.stage !== undefined) {
    const parsedStage = readStage(body);
    if (!parsedStage.ok) return parsedStage;
    stage = parsedStage.value;
  }

  let notes = '';
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') {
      return { ok: false, error: 'notes must be a string' };
    }
    notes = body.notes.trim();
  }

  return {
    ok: true,
    value: {
      title: title.value,
      funder: funder.value,
      focus: focus.value,
      deadline: deadline.value,
      amount: amount.value,
      owner: owner.value,
      stage,
      notes,
    },
  };
}

export function validateUpdateInput(body: unknown): ValidationResult<UpdateApplicationInput> {
  if (!isRecord(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const patch: UpdateApplicationInput = {};

  if ('title' in body) {
    const title = readText(body, 'title');
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if ('funder' in body) {
    const funder = readText(body, 'funder');
    if (!funder.ok) return funder;
    patch.funder = funder.value;
  }
  if ('focus' in body) {
    const focus = readText(body, 'focus');
    if (!focus.ok) return focus;
    patch.focus = focus.value;
  }
  if ('owner' in body) {
    const owner = readText(body, 'owner');
    if (!owner.ok) return owner;
    patch.owner = owner.value;
  }
  if ('deadline' in body) {
    const deadline = readDeadline(body);
    if (!deadline.ok) return deadline;
    patch.deadline = deadline.value;
  }
  if ('amount' in body) {
    const amount = readAmount(body);
    if (!amount.ok) return amount;
    patch.amount = amount.value;
  }
  if ('stage' in body) {
    const stage = readStage(body);
    if (!stage.ok) return stage;
    patch.stage = stage.value;
  }
  if ('notes' in body) {
    if (typeof body.notes !== 'string') {
      return { ok: false, error: 'notes must be a string' };
    }
    patch.notes = body.notes.trim();
  }

  return { ok: true, value: patch };
}

export function validateTaskLabel(body: unknown): ValidationResult<string> {
  if (!isRecord(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const label = readText(body, 'label');
  if (!label.ok) {
    return { ok: false, error: 'label is required and must be a non-empty string' };
  }
  return label;
}

export function validateTaskDone(body: unknown): ValidationResult<boolean> {
  if (!isRecord(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  if (typeof body.done !== 'boolean') {
    return { ok: false, error: 'done must be a boolean' };
  }
  return { ok: true, value: body.done };
}

function sequenceFromIds(ids: string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest;
}

function formatId(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(3, '0')}`;
}

export class GrantStore {
  private applications: GrantApplication[] = [];
  private activities: Activity[] = [];
  private applicationSequence = 0;
  private taskSequence = 0;
  private activitySequence = 0;
  private clockMs = CLOCK_START_MS;

  constructor() {
    this.reset();
  }

  /** Restores the deterministic seed data and resets generated ids and the clock. */
  reset(): void {
    this.applications = clone(SEED_APPLICATIONS);
    this.activities = clone(SEED_ACTIVITIES);
    this.sortActivities();
    this.applicationSequence = sequenceFromIds(
      SEED_APPLICATIONS.map((application) => application.id),
      'app',
    );
    this.taskSequence = sequenceFromIds(
      SEED_APPLICATIONS.flatMap((application) => application.tasks.map((task) => task.id)),
      'task',
    );
    this.activitySequence = sequenceFromIds(
      SEED_ACTIVITIES.map((activity) => activity.id),
      'act',
    );
    this.clockMs = CLOCK_START_MS;
  }

  listApplications(filter: ApplicationFilter = {}): GrantApplication[] {
    const query = filter.query?.trim().toLowerCase() ?? '';
    const stage = filter.stage;
    const matches = this.applications.filter((application) => {
      if (stage !== undefined && application.stage !== stage) {
        return false;
      }
      if (query === '') {
        return true;
      }
      return [application.title, application.funder, application.focus, application.owner].some(
        (field) => field.toLowerCase().includes(query),
      );
    });
    matches.sort(
      (left, right) =>
        left.deadline.localeCompare(right.deadline) || left.id.localeCompare(right.id),
    );
    return clone(matches);
  }

  getApplication(id: string): GrantApplication | undefined {
    const application = this.applications.find((candidate) => candidate.id === id);
    return application ? clone(application) : undefined;
  }

  getSummary(): Summary {
    const stageCounts: Record<GrantStage, number> = {
      prospecting: 0,
      drafting: 0,
      review: 0,
      submitted: 0,
      awarded: 0,
      declined: 0,
    };
    const dueSoonEnd = addDays(SEED_REFERENCE_DATE, DUE_SOON_DAYS);
    let activeApplications = 0;
    let pipelineValue = 0;
    let awardedValue = 0;
    let dueSoon = 0;
    let totalTasks = 0;
    let completedTasks = 0;

    for (const application of this.applications) {
      stageCounts[application.stage] += 1;
      totalTasks += application.tasks.length;
      completedTasks += application.tasks.filter((task) => task.done).length;

      if (application.stage === 'awarded') {
        awardedValue += application.amount;
        continue;
      }
      if (application.stage === 'declined') {
        continue;
      }
      activeApplications += 1;
      pipelineValue += application.amount;
      if (application.deadline >= SEED_REFERENCE_DATE && application.deadline <= dueSoonEnd) {
        dueSoon += 1;
      }
    }

    return {
      totalApplications: this.applications.length,
      activeApplications,
      pipelineValue: roundMoney(pipelineValue),
      awardedValue: roundMoney(awardedValue),
      dueSoon,
      completionRate: totalTasks === 0 ? 0 : completedTasks / totalTasks,
      stageCounts,
    };
  }

  listActivity(filter: number | ActivityFilter = {}): Activity[] {
    const options: ActivityFilter = typeof filter === 'number' ? { limit: filter } : filter;
    const requested = options.limit ?? DEFAULT_ACTIVITY_LIMIT;
    const limit = Math.max(0, Math.min(Math.floor(requested), MAX_ACTIVITY_LIMIT));
    const applicationId = options.applicationId;
    const matches =
      applicationId === undefined
        ? this.activities
        : this.activities.filter((activity) => activity.applicationId === applicationId);
    return clone(matches.slice(0, limit));
  }

  createApplication(input: CreateApplicationInput): GrantApplication {
    const now = this.nextTimestamp();
    const application: GrantApplication = {
      id: this.nextApplicationId(),
      title: input.title.trim(),
      funder: input.funder.trim(),
      focus: input.focus.trim(),
      amount: input.amount,
      deadline: input.deadline,
      stage: input.stage ?? 'prospecting',
      owner: input.owner.trim(),
      notes: input.notes?.trim() ?? '',
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    this.applications.push(application);
    this.recordActivity(application, 'created', `Created application "${application.title}"`);
    return clone(application);
  }

  updateApplication(id: string, patch: UpdateApplicationInput): GrantApplication | undefined {
    const index = this.applications.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      return undefined;
    }
    const current = this.applications[index];
    if (!current) {
      return undefined;
    }

    const hasPatch = Object.keys(patch).length > 0;
    if (!hasPatch) {
      return clone(current);
    }

    const updated: GrantApplication = { ...current };
    const changedFields: string[] = [];
    if (patch.title !== undefined) {
      updated.title = patch.title;
      changedFields.push('title');
    }
    if (patch.funder !== undefined) {
      updated.funder = patch.funder;
      changedFields.push('funder');
    }
    if (patch.focus !== undefined) {
      updated.focus = patch.focus;
      changedFields.push('focus');
    }
    if (patch.deadline !== undefined) {
      updated.deadline = patch.deadline;
      changedFields.push('deadline');
    }
    if (patch.amount !== undefined) {
      updated.amount = patch.amount;
      changedFields.push('amount');
    }
    if (patch.stage !== undefined) {
      updated.stage = patch.stage;
      changedFields.push('stage');
    }
    if (patch.owner !== undefined) {
      updated.owner = patch.owner;
      changedFields.push('owner');
    }
    if (patch.notes !== undefined) {
      updated.notes = patch.notes;
      changedFields.push('notes');
    }
    updated.updatedAt = this.nextTimestamp();
    this.applications[index] = updated;

    if (patch.stage !== undefined && patch.stage !== current.stage) {
      this.recordActivity(
        updated,
        'stage',
        `Stage changed from ${current.stage} to ${updated.stage}`,
      );
    } else {
      this.recordActivity(updated, 'updated', `Updated ${changedFields.join(', ')}`);
    }
    return clone(updated);
  }

  deleteApplication(id: string): boolean {
    const index = this.applications.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      return false;
    }
    this.applications.splice(index, 1);
    return true;
  }

  addTask(applicationId: string, label: string): GrantApplication | undefined {
    const application = this.applications.find((candidate) => candidate.id === applicationId);
    if (!application) {
      return undefined;
    }
    const task: GrantTask = {
      id: this.nextTaskId(),
      label: label.trim(),
      done: false,
    };
    application.tasks.push(task);
    application.updatedAt = this.nextTimestamp();
    this.recordActivity(application, 'task', `Added task "${task.label}"`);
    return clone(application);
  }

  toggleTask(applicationId: string, taskId: string, done: boolean): GrantApplication | undefined {
    const application = this.applications.find((candidate) => candidate.id === applicationId);
    if (!application) {
      return undefined;
    }
    const task = application.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      return undefined;
    }
    task.done = done;
    application.updatedAt = this.nextTimestamp();
    this.recordActivity(
      application,
      'task',
      done ? `Completed task "${task.label}"` : `Reopened task "${task.label}"`,
    );
    return clone(application);
  }

  deleteTask(applicationId: string, taskId: string): GrantApplication | undefined {
    const application = this.applications.find((candidate) => candidate.id === applicationId);
    if (!application) {
      return undefined;
    }
    const index = application.tasks.findIndex((candidate) => candidate.id === taskId);
    if (index === -1) {
      return undefined;
    }
    const [removed] = application.tasks.splice(index, 1);
    application.updatedAt = this.nextTimestamp();
    this.recordActivity(application, 'task', `Removed task "${removed?.label ?? taskId}"`);
    return clone(application);
  }

  private sortActivities(): void {
    this.activities.sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
  }

  private recordActivity(
    application: GrantApplication | null,
    kind: ActivityKind,
    message: string,
  ): void {
    const activity: Activity = {
      id: this.nextActivityId(),
      applicationId: application ? application.id : null,
      applicationTitle: application ? application.title : 'Workspace',
      message,
      createdAt: this.nextTimestamp(),
      kind,
    };
    this.activities.unshift(activity);
  }

  private nextTimestamp(): string {
    const timestamp = new Date(this.clockMs).toISOString();
    this.clockMs += CLOCK_STEP_MS;
    return timestamp;
  }

  private nextApplicationId(): string {
    this.applicationSequence += 1;
    return formatId('app', this.applicationSequence);
  }

  private nextTaskId(): string {
    this.taskSequence += 1;
    return formatId('task', this.taskSequence);
  }

  private nextActivityId(): string {
    this.activitySequence += 1;
    return formatId('act', this.activitySequence);
  }
}

export function createStore(): GrantStore {
  return new GrantStore();
}

export const store = createStore();

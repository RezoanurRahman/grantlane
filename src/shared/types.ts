export const GRANT_STAGES = [
  'prospecting',
  'drafting',
  'review',
  'submitted',
  'awarded',
  'declined',
] as const;

export type GrantStage = (typeof GRANT_STAGES)[number];

export const ACTIVITY_KINDS = ['created', 'updated', 'task', 'stage'] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface GrantTask {
  id: string;
  label: string;
  done: boolean;
}

export interface GrantApplication {
  id: string;
  title: string;
  funder: string;
  focus: string;
  amount: number;
  /** Deadline in YYYY-MM-DD form. */
  deadline: string;
  stage: GrantStage;
  owner: string;
  notes: string;
  tasks: GrantTask[];
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  applicationId: string | null;
  applicationTitle: string;
  message: string;
  createdAt: string;
  kind: ActivityKind;
}

export interface Summary {
  totalApplications: number;
  activeApplications: number;
  pipelineValue: number;
  awardedValue: number;
  dueSoon: number;
  completionRate: number;
  stageCounts: Record<GrantStage, number>;
}

/** Payload accepted by POST /api/applications. `stage` and `notes` are normalized by the store. */
export interface CreateApplicationInput {
  title: string;
  funder: string;
  focus: string;
  deadline: string;
  amount: number;
  owner: string;
  stage?: GrantStage;
  notes?: string;
}

/** Fields a client may change through PATCH /api/applications/:id. */
export const EDITABLE_FIELDS = [
  'title',
  'funder',
  'focus',
  'deadline',
  'amount',
  'stage',
  'owner',
  'notes',
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

export type UpdateApplicationInput = Partial<Pick<GrantApplication, EditableField>>;

export interface ApplicationFilter {
  query?: string;
  stage?: GrantStage;
}

export interface ActivityFilter {
  limit?: number;
  applicationId?: string;
}

export function isGrantStage(value: unknown): value is GrantStage {
  return typeof value === 'string' && (GRANT_STAGES as readonly string[]).includes(value);
}

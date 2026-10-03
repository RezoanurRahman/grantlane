import { render } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  GRANT_STAGES,
  isGrantStage,
  type Activity,
  type GrantApplication,
  type GrantStage,
  type GrantTask,
  type Summary,
} from '../shared/types';
import {
  addTask,
  createApplication,
  deleteApplication,
  fetchActivity,
  fetchApplication,
  fetchApplications,
  fetchSummary,
  removeTask,
  toggleTask,
  updateApplication,
} from './api';
import type { ApplicationDraft, ApplicationFilters } from './api';
import './styles.css';

/* --------------------------------------------------------------- demo clock */

const DEMO_TODAY_ISO = '2026-10-03';
const DEMO_TODAY_LABEL = 'Oct 3, 2026';
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------- stages */

const STAGE_LABELS: Record<GrantStage, string> = {
  prospecting: 'Prospecting',
  drafting: 'Drafting',
  review: 'Review',
  submitted: 'Submitted',
  awarded: 'Awarded',
  declined: 'Declined',
};

/* -------------------------------------------------------------------- icons */

const ICON_PATHS = {
  mark: 'M5 17V4M5 4.6h8.3l-1.7 2.6 1.7 2.6H5',
  overview: 'M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z',
  pipeline: 'M3 5h14M3 10h10M3 15h6',
  activity: 'M3 12h3l2-5 3 9 2-5h4',
  plus: 'M10 4v12M4 10h12',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.6-3.6',
  close: 'M5 5l10 10M15 5L5 15',
  alert: 'M10 3.6l6.5 11.8h-13zM10 8.6v3.4M10 14.5h.01',
  refresh: 'M16 10a6 6 0 1 1-1.8-4.3M16 4.2v3.8h-3.8',
  check: 'M4 10.5l4 4 8-9',
  trash: 'M4 6h12M8 6V3.8h4V6M6.2 6l.9 11h5.8l.9-11',
  calendar: 'M4 5.5h12v11H4zM4 9.5h12M7 3v4M13 3v4',
  clock: 'M10 6.2v4l2.8 1.8M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
  document: 'M6 3h5l3 3v11H6zM11 3.2V6h2.8',
} as const;

type IconName = keyof typeof ICON_PATHS;

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/* --------------------------------------------------------------- formatting */

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

const DEMO_TODAY_DATE = parseDateOnly(DEMO_TODAY_ISO) ?? new Date(Date.UTC(2026, 9, 3, 12, 0, 0));

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const deadlineFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
});

function formatCurrency(amount: number): string {
  return currencyFormatter.format(Number.isFinite(amount) ? amount : 0);
}

function formatDeadline(deadline: string): string {
  const date = parseDateOnly(deadline);
  return date ? deadlineFormatter.format(date) : 'No date';
}

function daysUntil(deadline: string): number | null {
  const date = parseDateOnly(deadline);
  if (!date) return null;
  return Math.round((date.getTime() - DEMO_TODAY_DATE.getTime()) / DAY_MS);
}

type CueTone = 'overdue' | 'soon' | 'upcoming' | 'calm';

interface DeadlineCue {
  label: string;
  tone: CueTone;
}

function deadlineCue(deadline: string, stage?: GrantStage): DeadlineCue {
  if (stage === 'awarded' || stage === 'declined') {
    return { label: 'Closed', tone: 'calm' };
  }
  const days = daysUntil(deadline);
  if (days === null) return { label: 'No deadline', tone: 'calm' };
  if (days < -1) return { label: `${Math.abs(days)} days overdue`, tone: 'overdue' };
  if (days === -1) return { label: '1 day overdue', tone: 'overdue' };
  if (days === 0) return { label: 'Due today', tone: 'overdue' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'soon' };
  if (days <= 7) return { label: `Due in ${days} days`, tone: 'soon' };
  if (days <= 14) return { label: `Due in ${days} days`, tone: 'upcoming' };
  return { label: `Due in ${days} days`, tone: 'calm' };
}

function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = timeFormatter.format(date);
  const dayKey = date.toISOString().slice(0, 10);
  if (dayKey === DEMO_TODAY_ISO) return `Today · ${time}`;
  const yesterdayKey = new Date(DEMO_TODAY_DATE.getTime() - DAY_MS).toISOString().slice(0, 10);
  if (dayKey === yesterdayKey) return `Yesterday · ${time}`;
  return `${shortDateFormatter.format(date)} · ${time}`;
}

function normalizeCompletionRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const percent = rate <= 1 ? rate * 100 : rate;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function initials(name: string): string {
  let first = '';
  let last = '';
  let count = 0;
  for (const word of name.trim().split(/\s+/)) {
    if (word.length === 0) continue;
    if (count === 0) first = word.charAt(0);
    last = word.charAt(0);
    count += 1;
  }
  if (count === 0) return '?';
  return (count === 1 ? first : `${first}${last}`).toUpperCase();
}

function avatarTone(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return hash % 4;
}

function countTasks(applications: GrantApplication[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const application of applications) {
    total += application.tasks.length;
    for (const task of application.tasks) {
      if (task.done) done += 1;
    }
  }
  return { done, total };
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Something went wrong. Please try again.';
}

/* --------------------------------------------------------------- primitives */

function StageChip({ stage }: { stage: GrantStage }) {
  return <span class={`chip stage-chip stage-${stage}`}>{STAGE_LABELS[stage]}</span>;
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <span class={`avatar avatar-${size} avatar-tone-${avatarTone(name)}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      class={percent === 100 && total > 0 ? 'progress is-complete' : 'progress'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <span class="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

interface KpiCardProps {
  icon: IconName;
  tone: 'coral' | 'amber' | 'mint' | 'ink';
  label: string;
  value: string;
  detail: string;
  progress?: number;
}

function KpiCard({ icon, tone, label, value, detail, progress }: KpiCardProps) {
  return (
    <article class={`kpi-card tone-${tone}`}>
      <div class="kpi-head">
        <p class="kpi-label">{label}</p>
        <span class="kpi-icon" aria-hidden="true">
          <Icon name={icon} size={15} />
        </span>
      </div>
      <p class="kpi-value">{value}</p>
      {typeof progress === 'number' ? (
        <div class="kpi-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
      <p class="kpi-detail">{detail}</p>
    </article>
  );
}

interface ApplicationCardProps {
  application: GrantApplication;
  selected: boolean;
  onSelect: (id: string) => void;
}

function ApplicationCard({ application, selected, onSelect }: ApplicationCardProps) {
  const done = application.tasks.filter((task) => task.done).length;
  const total = application.tasks.length;
  const cue = deadlineCue(application.deadline, application.stage);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <li class="pipeline-item">
      <button
        type="button"
        class={selected ? 'application-card is-selected' : 'application-card'}
        aria-pressed={selected}
        onClick={() => onSelect(application.id)}
      >
        <span class="card-top">
          <span class="card-funder">{application.funder}</span>
          <StageChip stage={application.stage} />
        </span>
        <span class="card-title">{application.title}</span>
        <span class="card-meta">
          <span class="meta-item">
            <Icon name="calendar" size={13} />
            {formatDeadline(application.deadline)}
          </span>
          <span class={`chip cue-chip cue-${cue.tone}`}>{cue.label}</span>
          <span class="meta-item meta-amount">{formatCurrency(application.amount)}</span>
          <span class="meta-item">
            <Avatar name={application.owner} size="xs" />
            {application.owner}
          </span>
        </span>
        <span class="card-checklist">
          <span class="mini-progress" aria-hidden="true">
            <span class="mini-progress-fill" style={{ width: `${percent}%` }} />
          </span>
          <span class="progress-label">
            {total > 0 ? `${done}/${total} checklist items` : 'No checklist items yet'}
          </span>
        </span>
      </button>
    </li>
  );
}

interface ActivityFeedProps {
  entries: Activity[];
  emptyText: string;
  onSelect?: (id: string) => void;
}

function ActivityFeed({ entries, emptyText, onSelect }: ActivityFeedProps) {
  if (entries.length === 0) {
    return <p class="feed-empty">{emptyText}</p>;
  }
  return (
    <ol class="feed-list">
      {entries.map((entry) => {
        const target = entry.applicationId;
        return (
          <li class="feed-item" key={entry.id}>
            <span class={`feed-dot kind-${entry.kind}`} aria-hidden="true" />
            <div class="feed-body">
              <p class="feed-message">{entry.message}</p>
              <p class="feed-meta">
                <span>{formatActivityTime(entry.createdAt)}</span>
                <span class="feed-sep" aria-hidden="true">
                  ·
                </span>
                <span>{entry.applicationTitle}</span>
              </p>
            </div>
            {onSelect && target ? (
              <button type="button" class="feed-action" onClick={() => onSelect(target)}>
                Open
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------- create form */

interface ApplicationFormState {
  title: string;
  funder: string;
  focus: string;
  deadline: string;
  amount: string;
  stage: string;
  owner: string;
  notes: string;
}

const EMPTY_FORM: ApplicationFormState = {
  title: '',
  funder: '',
  focus: '',
  deadline: '',
  amount: '',
  stage: 'prospecting',
  owner: '',
  notes: '',
};

function validateDraft(form: ApplicationFormState): string | null {
  if (!form.title.trim()) return 'Give the application a title.';
  if (!form.funder.trim()) return 'Add the funder or program name.';
  if (!form.focus.trim()) return 'Describe the funding focus in a few words.';
  if (!form.deadline.trim()) return 'Pick a deadline date.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.deadline.trim())) {
    return 'Deadlines use the YYYY-MM-DD format.';
  }
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Enter a requested amount greater than zero.';
  }
  if (!isGrantStage(form.stage)) return 'Choose a valid pipeline stage.';
  if (!form.owner.trim()) return 'Assign an owner.';
  return null;
}

interface NewApplicationModalProps {
  open: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (draft: ApplicationDraft) => void;
}

function NewApplicationModal({ open, busy, error, onClose, onSubmit }: NewApplicationModalProps) {
  const [form, setForm] = useState<ApplicationFormState>(EMPTY_FORM);
  const [localError, setLocalError] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setLocalError('');
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (previous && previous.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busy) onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      );
      const first = focusables.item(0);
      const last = focusables.item(focusables.length - 1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    const problem = validateDraft(form);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError('');
    onSubmit({
      title: form.title.trim(),
      funder: form.funder.trim(),
      focus: form.focus.trim(),
      deadline: form.deadline.trim(),
      amount: Number(form.amount),
      stage: isGrantStage(form.stage) ? form.stage : 'prospecting',
      owner: form.owner.trim(),
      notes: form.notes.trim(),
    });
  };

  const message = localError || error;

  return (
    <div
      class="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-application-title"
        ref={dialogRef}
      >
        <div class="modal-head">
          <div>
            <p class="modal-eyebrow">New record</p>
            <h2 class="modal-title" id="new-application-title">
              New application
            </h2>
            <p class="modal-sub">
              Add an opportunity to the pipeline. Notes and checklist items can follow later.
            </p>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close new application dialog"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <form class="modal-form" onSubmit={handleSubmit}>
          <div class="modal-body">
            {message ? (
              <p class="form-error" role="alert">
                <Icon name="alert" size={15} />
                {message}
              </p>
            ) : null}
            <fieldset class="form-grid" disabled={busy}>
              <legend class="sr-only">Application details</legend>
              <label class="form-field is-wide">
                <span>Title</span>
                <input
                  ref={firstFieldRef}
                  type="text"
                  name="title"
                  value={form.title}
                  placeholder="e.g. Rural energy access grant"
                  maxLength={140}
                  onInput={(event) =>
                    setForm((current) => ({ ...current, title: event.currentTarget.value }))
                  }
                />
              </label>
              <label class="form-field">
                <span>Funder</span>
                <input
                  type="text"
                  name="funder"
                  value={form.funder}
                  placeholder="e.g. Harborlight Foundation"
                  maxLength={120}
                  onInput={(event) =>
                    setForm((current) => ({ ...current, funder: event.currentTarget.value }))
                  }
                />
              </label>
              <label class="form-field">
                <span>Focus area</span>
                <input
                  type="text"
                  name="focus"
                  value={form.focus}
                  placeholder="e.g. Community energy"
                  maxLength={120}
                  onInput={(event) =>
                    setForm((current) => ({ ...current, focus: event.currentTarget.value }))
                  }
                />
              </label>
              <label class="form-field">
                <span>Deadline</span>
                <input
                  type="date"
                  name="deadline"
                  value={form.deadline}
                  onInput={(event) =>
                    setForm((current) => ({ ...current, deadline: event.currentTarget.value }))
                  }
                />
              </label>
              <label class="form-field">
                <span>Requested amount (USD)</span>
                <input
                  type="number"
                  name="amount"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={form.amount}
                  placeholder="50000"
                  onInput={(event) =>
                    setForm((current) => ({ ...current, amount: event.currentTarget.value }))
                  }
                />
              </label>
              <label class="form-field">
                <span>Stage</span>
                <select
                  name="stage"
                  value={form.stage}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, stage: event.currentTarget.value }))
                  }
                >
                  {GRANT_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {STAGE_LABELS[stage]}
                    </option>
                  ))}
                </select>
              </label>
              <label class="form-field">
                <span>Owner</span>
                <input
                  type="text"
                  name="owner"
                  value={form.owner}
                  placeholder="e.g. Dana Whitfield"
                  maxLength={120}
                  onInput={(event) =>
                    setForm((current) => ({ ...current, owner: event.currentTarget.value }))
                  }
                />
              </label>
              <label class="form-field is-wide">
                <span>Notes</span>
                <textarea
                  name="notes"
                  rows={3}
                  value={form.notes}
                  placeholder="Context, funder signals, or the next concrete step."
                  maxLength={600}
                  onInput={(event) =>
                    setForm((current) => ({ ...current, notes: event.currentTarget.value }))
                  }
                />
              </label>
            </fieldset>
          </div>
          <div class="modal-foot">
            <button type="button" class="button button-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" class="button button-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- the app */

interface StatusMessage {
  tone: 'info' | 'error';
  message: string;
}

function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [applications, setApplications] = useState<GrantApplication[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [bootState, setBootState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootError, setBootError] = useState('');
  const [listBusy, setListBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<GrantStage | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<GrantApplication | null>(null);
  const [detailActivity, setDetailActivity] = useState<Activity[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');

  const workspaceTokenRef = useRef(0);
  const bootedRef = useRef(false);
  const autoSelectRef = useRef(false);
  const statusTimerRef = useRef<number | null>(null);
  const detailColumnRef = useRef<HTMLDivElement | null>(null);

  const showStatus = useCallback((next: StatusMessage) => {
    setStatus(next);
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = null;
      setStatus(null);
    }, 5200);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    };
  }, []);

  const scrollDetailIntoView = useCallback(() => {
    if (!window.matchMedia('(max-width: 1100px)').matches) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => {
      detailColumnRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  }, []);

  const openApplication = useCallback(
    (id: string) => {
      setSelectedId(id);
      scrollDetailIntoView();
    },
    [scrollDetailIntoView],
  );

  const applyUpdatedApplication = useCallback((updated: GrantApplication) => {
    setApplications((current) =>
      current.map((application) => (application.id === updated.id ? updated : application)),
    );
    setSelectedApplication((current) => (current && current.id === updated.id ? updated : current));
  }, []);

  const loadWorkspace = useCallback(
    async (mode: 'boot' | 'refresh') => {
      const token = ++workspaceTokenRef.current;
      if (mode === 'boot') {
        setBootState('loading');
      } else {
        setListBusy(true);
      }
      const filters: ApplicationFilters = {};
      const trimmedQuery = query.trim();
      if (trimmedQuery) filters.query = trimmedQuery;
      if (stageFilter !== 'all') filters.stage = stageFilter;

      try {
        const [nextSummary, nextApplications, nextActivity] = await Promise.all([
          fetchSummary(),
          fetchApplications(filters),
          fetchActivity(10),
        ]);
        if (token !== workspaceTokenRef.current) return;
        setSummary(nextSummary);
        setApplications(nextApplications);
        if (!autoSelectRef.current) {
          const first = nextApplications.at(0);
          if (first) {
            autoSelectRef.current = true;
            setSelectedId(first.id);
          }
        }
        setActivity(nextActivity);
        setBootError('');
        setBootState('ready');
      } catch (error) {
        if (token !== workspaceTokenRef.current) return;
        const message = toMessage(error);
        if (mode === 'boot') {
          setBootError(message);
          setBootState('error');
        } else {
          showStatus({ tone: 'error', message });
        }
      } finally {
        if (token === workspaceTokenRef.current && mode === 'refresh') setListBusy(false);
      }
    },
    [query, stageFilter, showStatus],
  );

  useEffect(() => {
    if (!bootedRef.current) {
      bootedRef.current = true;
      void loadWorkspace('boot');
      return;
    }
    const timer = window.setTimeout(() => {
      void loadWorkspace('refresh');
    }, 220);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedApplication(null);
      setDetailActivity([]);
      setDetailError('');
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');
    setDetailActivity([]);
    fetchApplication(selectedId)
      .then((application) => {
        if (cancelled) return;
        setSelectedApplication(application);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetailError(toMessage(error));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    fetchActivity(6, selectedId)
      .then((entries) => {
        if (!cancelled) setDetailActivity(entries);
      })
      .catch(() => {
        if (!cancelled) setDetailActivity([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, detailReloadToken]);

  useEffect(() => {
    setConfirmDelete(false);
    setTaskDraft('');
  }, [selectedId]);

  const openCreate = useCallback(() => {
    setCreateError('');
    setModalOpen(true);
  }, []);

  const closeCreate = useCallback(() => {
    setModalOpen(false);
    setCreateError('');
  }, []);

  const retryBoot = useCallback(() => {
    bootedRef.current = true;
    void loadWorkspace('boot');
  }, [loadWorkspace]);

  const handleCreate = async (draft: ApplicationDraft) => {
    setCreateBusy(true);
    setCreateError('');
    try {
      const created = await createApplication(draft);
      setModalOpen(false);
      autoSelectRef.current = true;
      applyUpdatedApplication(created);
      setSelectedApplication(created);
      setSelectedId(created.id);
      showStatus({ tone: 'info', message: `Created “${created.title}”.` });
      void loadWorkspace('refresh');
    } catch (error) {
      setCreateError(toMessage(error));
    } finally {
      setCreateBusy(false);
    }
  };

  const runApplicationMutation = useCallback(
    async (
      key: string,
      action: () => Promise<GrantApplication>,
      successMessage: (application: GrantApplication) => string,
      onSuccess?: (application: GrantApplication) => void,
    ) => {
      setBusyAction(key);
      try {
        const updated = await action();
        applyUpdatedApplication(updated);
        onSuccess?.(updated);
        setDetailReloadToken((token) => token + 1);
        showStatus({ tone: 'info', message: successMessage(updated) });
        void loadWorkspace('refresh');
      } catch (error) {
        showStatus({ tone: 'error', message: toMessage(error) });
      } finally {
        setBusyAction(null);
      }
    },
    [applyUpdatedApplication, loadWorkspace, showStatus],
  );

  const detailApplication =
    selectedId && selectedApplication && selectedApplication.id === selectedId
      ? selectedApplication
      : null;

  const handleStageChange = (stage: GrantStage) => {
    if (!detailApplication) return;
    const application = detailApplication;
    void runApplicationMutation(
      'stage',
      () => updateApplication(application.id, { stage }),
      (updated) => `Moved “${updated.title}” to ${STAGE_LABELS[updated.stage]}.`,
    );
  };

  const handleToggleTask = (task: GrantTask, done: boolean) => {
    if (!detailApplication) return;
    const application = detailApplication;
    void runApplicationMutation(
      `task-${task.id}`,
      () => toggleTask(application.id, task.id, done),
      () => `${done ? 'Checked off' : 'Reopened'} “${task.label}”.`,
    );
  };

  const handleAddTask = () => {
    if (!detailApplication) return;
    const application = detailApplication;
    const label = taskDraft.trim();
    if (!label) return;
    void runApplicationMutation(
      'task-new',
      () => addTask(application.id, label),
      () => `Added “${label}” to the checklist.`,
      () => setTaskDraft(''),
    );
  };

  const handleRemoveTask = (task: GrantTask) => {
    if (!detailApplication) return;
    const application = detailApplication;
    void runApplicationMutation(
      `task-remove-${task.id}`,
      () => removeTask(application.id, task.id),
      () => `Removed “${task.label}”.`,
    );
  };

  const handleDelete = () => {
    if (!detailApplication) return;
    const application = detailApplication;
    void (async () => {
      setBusyAction('delete');
      try {
        await deleteApplication(application.id);
        setApplications((current) => current.filter((item) => item.id !== application.id));
        setSelectedApplication(null);
        setSelectedId(null);
        setConfirmDelete(false);
        showStatus({ tone: 'info', message: `Deleted “${application.title}”.` });
        void loadWorkspace('refresh');
      } catch (error) {
        showStatus({ tone: 'error', message: toMessage(error) });
      } finally {
        setBusyAction(null);
      }
    })();
  };

  const tasks = countTasks(applications);
  const completion = summary ? normalizeCompletionRate(summary.completionRate) : 0;
  const awardedCount = summary ? summary.stageCounts.awarded || 0 : 0;
  const applicationActivity = detailActivity;
  const filtered = query.trim().length > 0 || stageFilter !== 'all';
  const pipelineSub = summary
    ? filtered
      ? `${applications.length} of ${summary.totalApplications} applications in view`
      : `${summary.totalApplications} applications tracked · ${summary.activeApplications} active`
    : 'Loading pipeline…';

  return (
    <div class="app-shell">
      <aside class="rail" aria-label="Grantlane workspace">
        <div class="rail-brand">
          <span class="brand-mark" aria-hidden="true">
            <Icon name="mark" size={19} />
          </span>
          <span class="brand-text">
            <span class="brand-name">Grantlane</span>
            <span class="brand-tag">Grant desk</span>
          </span>
        </div>
        <nav class="rail-nav" aria-label="Sections">
          <a class="rail-link" href="#overview">
            <Icon name="overview" size={15} />
            Overview
          </a>
          <a class="rail-link is-current" href="#pipeline" aria-current="page">
            <Icon name="pipeline" size={15} />
            Pipeline
          </a>
          <a class="rail-link" href="#activity">
            <Icon name="activity" size={15} />
            Activity
          </a>
        </nav>
        <div class="rail-status">
          <span
            class={bootState === 'error' ? 'status-led is-error' : 'status-led'}
            aria-hidden="true"
          />
          <div class="status-copy">
            <p class="status-title">
              {bootState === 'error' ? 'API unreachable' : 'Local workspace · API connected'}
            </p>
            <p class="status-meta">Fixed demo date · {DEMO_TODAY_LABEL}</p>
            <p class="status-meta is-dim">
              {summary
                ? `${summary.activeApplications} active · ${formatCurrency(summary.pipelineValue)} requested`
                : 'In-memory data resets when the server restarts'}
            </p>
          </div>
        </div>
      </aside>

      <main class="workspace">
        <header class="page-header">
          <div class="page-heading">
            <nav class="breadcrumb-nav" aria-label="Breadcrumb">
              <ol class="breadcrumb">
                <li>Grantlane</li>
                <li>Workspace</li>
                <li aria-current="page">Funding pipeline</li>
              </ol>
            </nav>
            <h1 class="page-title">Funding pipeline</h1>
            <p class="page-subtitle">
              Every grant opportunity from first lead to decision — stages, deadlines, owners, and
              the checklist that keeps each submission moving.
            </p>
          </div>
          <button type="button" class="button button-primary page-cta" onClick={openCreate}>
            <Icon name="plus" size={17} />
            New application
          </button>
        </header>

        {bootState === 'error' ? (
          <section class="error-panel" role="alert">
            <span class="state-icon is-error" aria-hidden="true">
              <Icon name="alert" size={20} />
            </span>
            <div class="error-copy">
              <h2 class="error-title">Grantlane could not load the workspace</h2>
              <p class="error-message">{bootError}</p>
              <p class="error-hint">
                Start the API with <code>npm run dev</code> or run the production server, then
                retry.
              </p>
            </div>
            <button type="button" class="button button-primary" onClick={retryBoot}>
              <Icon name="refresh" size={16} />
              Retry
            </button>
          </section>
        ) : (
          <section class="kpi-section" id="overview" aria-labelledby="overview-heading">
            <h2 class="sr-only" id="overview-heading">
              Pipeline overview
            </h2>
            {bootState === 'loading' ? (
              <div class="kpi-grid" aria-hidden="true">
                <div class="kpi-card is-skeleton" />
                <div class="kpi-card is-skeleton" />
                <div class="kpi-card is-skeleton" />
                <div class="kpi-card is-skeleton" />
              </div>
            ) : summary ? (
              <div class="kpi-grid">
                <KpiCard
                  icon="pipeline"
                  tone="coral"
                  label="Active pipeline"
                  value={String(summary.activeApplications)}
                  detail={`${formatCurrency(summary.pipelineValue)} requested across open stages`}
                />
                <KpiCard
                  icon="clock"
                  tone="amber"
                  label="Due soon"
                  value={String(summary.dueSoon)}
                  detail={`Deadlines within 14 days of ${DEMO_TODAY_LABEL}`}
                />
                <KpiCard
                  icon="check"
                  tone="mint"
                  label="Awarded"
                  value={formatCurrency(summary.awardedValue)}
                  detail={`${awardedCount} ${awardedCount === 1 ? 'application' : 'applications'} marked awarded`}
                />
                <KpiCard
                  icon="document"
                  tone="ink"
                  label="Checklist completion"
                  value={`${completion}%`}
                  detail={`${tasks.done} of ${tasks.total} checklist tasks complete`}
                  progress={completion}
                />
              </div>
            ) : null}
          </section>
        )}

        {bootState !== 'error' ? (
          <>
            <div class="workspace-grid">
              <section
                class="panel pipeline-panel"
                id="pipeline"
                aria-labelledby="pipeline-heading"
              >
                <div class="panel-head">
                  <div>
                    <h2 class="panel-title" id="pipeline-heading">
                      Pipeline
                    </h2>
                    <p class="panel-sub">{pipelineSub}</p>
                  </div>
                  <span class="panel-badge">{applications.length} shown</span>
                </div>
                <div class="pipeline-toolbar">
                  <div class="search-field">
                    <Icon name="search" size={15} />
                    <label class="sr-only" for="pipeline-search">
                      Search applications
                    </label>
                    <input
                      id="pipeline-search"
                      type="search"
                      value={query}
                      placeholder="Search funder, title, focus, or owner…"
                      onInput={(event) => setQuery(event.currentTarget.value)}
                    />
                    {query ? (
                      <button
                        type="button"
                        class="icon-button"
                        aria-label="Clear search"
                        onClick={() => setQuery('')}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    ) : null}
                  </div>
                  <div class="filter-field">
                    <label class="sr-only" for="pipeline-stage">
                      Filter by stage
                    </label>
                    <select
                      id="pipeline-stage"
                      value={stageFilter}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (value === 'all') setStageFilter('all');
                        else if (isGrantStage(value)) setStageFilter(value);
                      }}
                    >
                      <option value="all">All stages</option>
                      {GRANT_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {listBusy ? (
                    <span class="list-busy" role="status">
                      <span class="spinner" aria-hidden="true" />
                      Updating
                    </span>
                  ) : (
                    <span class="result-count" aria-live="polite">
                      {applications.length}{' '}
                      {applications.length === 1 ? 'application' : 'applications'}
                    </span>
                  )}
                </div>
                {bootState === 'loading' ? (
                  <div class="pipeline-list is-loading" aria-hidden="true">
                    <div class="card-skeleton" />
                    <div class="card-skeleton" />
                    <div class="card-skeleton" />
                  </div>
                ) : applications.length === 0 ? (
                  <div class="empty-state">
                    <span class="state-icon" aria-hidden="true">
                      <Icon name="pipeline" size={20} />
                    </span>
                    <h3>{filtered ? 'No applications match' : 'No applications yet'}</h3>
                    <p>
                      {filtered
                        ? 'Try a different search term or clear the stage filter.'
                        : 'Add the first grant opportunity to start tracking its deadline and checklist.'}
                    </p>
                    {filtered ? (
                      <button
                        type="button"
                        class="button button-ghost"
                        onClick={() => {
                          setQuery('');
                          setStageFilter('all');
                        }}
                      >
                        Clear filters
                      </button>
                    ) : (
                      <button type="button" class="button button-primary" onClick={openCreate}>
                        <Icon name="plus" size={16} />
                        New application
                      </button>
                    )}
                  </div>
                ) : (
                  <ul class="pipeline-list" aria-busy={listBusy}>
                    {applications.map((application) => (
                      <ApplicationCard
                        key={application.id}
                        application={application}
                        selected={application.id === selectedId}
                        onSelect={openApplication}
                      />
                    ))}
                  </ul>
                )}
              </section>

              <div class="detail-column" ref={detailColumnRef}>
                <aside class="panel detail-panel" aria-label="Application details">
                  {bootState === 'loading' ? (
                    <div class="detail-skeleton" aria-hidden="true">
                      <div class="line-skeleton is-wide" />
                      <div class="line-skeleton" />
                      <div class="line-skeleton is-short" />
                      <div class="card-skeleton" />
                      <div class="card-skeleton" />
                    </div>
                  ) : !selectedId ? (
                    <div class="empty-state detail-empty">
                      <span class="state-icon" aria-hidden="true">
                        <Icon name="document" size={20} />
                      </span>
                      <h3>No application selected</h3>
                      <p>
                        Choose a grant from the pipeline list to review its stage, checklist, notes,
                        and activity.
                      </p>
                    </div>
                  ) : detailApplication ? (
                    <>
                      {detailError ? (
                        <p class="detail-warning" role="status">
                          <Icon name="alert" size={14} />
                          {detailError}
                          <button
                            type="button"
                            class="link-button"
                            onClick={() => setDetailReloadToken((token) => token + 1)}
                          >
                            Retry
                          </button>
                        </p>
                      ) : null}
                      <div class="detail-head">
                        <div class="detail-heading">
                          <p class="card-funder">{detailApplication.funder}</p>
                          <h2 class="detail-title">{detailApplication.title}</h2>
                        </div>
                        <button
                          type="button"
                          class="icon-button"
                          aria-label="Close details"
                          onClick={() => setSelectedId(null)}
                        >
                          <Icon name="close" size={15} />
                        </button>
                      </div>
                      <div class="detail-body">
                        <div class="detail-hero">
                          <p class="detail-amount">{formatCurrency(detailApplication.amount)}</p>
                          <div class="detail-hero-meta">
                            <StageChip stage={detailApplication.stage} />
                            <span
                              class={`chip cue-chip cue-${deadlineCue(detailApplication.deadline, detailApplication.stage).tone}`}
                            >
                              <Icon name="calendar" size={13} />
                              {
                                deadlineCue(detailApplication.deadline, detailApplication.stage)
                                  .label
                              }
                            </span>
                          </div>
                        </div>

                        <div class="detail-section">
                          <h3 class="detail-section-title">Stage</h3>
                          <label class="field">
                            <span class="sr-only">Update stage for {detailApplication.title}</span>
                            <select
                              class="field-select"
                              value={detailApplication.stage}
                              disabled={busyAction !== null}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                if (isGrantStage(value)) handleStageChange(value);
                              }}
                            >
                              {GRANT_STAGES.map((stage) => (
                                <option key={stage} value={stage}>
                                  {STAGE_LABELS[stage]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p class="field-hint">Stage moves are written to the activity feed.</p>
                        </div>

                        <dl class="meta-grid">
                          <div class="meta-block">
                            <dt>Deadline</dt>
                            <dd>{formatDeadline(detailApplication.deadline)}</dd>
                          </div>
                          <div class="meta-block">
                            <dt>Owner</dt>
                            <dd class="meta-owner">
                              <Avatar name={detailApplication.owner} size="sm" />
                              {detailApplication.owner}
                            </dd>
                          </div>
                          <div class="meta-block">
                            <dt>Focus area</dt>
                            <dd>{detailApplication.focus}</dd>
                          </div>
                          <div class="meta-block">
                            <dt>Requested</dt>
                            <dd>{formatCurrency(detailApplication.amount)}</dd>
                          </div>
                        </dl>

                        <div class="detail-section">
                          <h3 class="detail-section-title">Notes</h3>
                          <p
                            class={
                              detailApplication.notes ? 'detail-notes' : 'detail-notes is-empty'
                            }
                          >
                            {detailApplication.notes || 'No notes yet for this application.'}
                          </p>
                        </div>

                        <div class="detail-section">
                          <div class="detail-section-head">
                            <h3 class="detail-section-title">Checklist</h3>
                            <span class="detail-count">
                              {detailApplication.tasks.filter((task) => task.done).length}/
                              {detailApplication.tasks.length} done
                            </span>
                          </div>
                          <ProgressBar
                            done={detailApplication.tasks.filter((task) => task.done).length}
                            total={detailApplication.tasks.length}
                            label={`Checklist progress for ${detailApplication.title}`}
                          />
                          {detailApplication.tasks.length === 0 ? (
                            <p class="detail-empty-line">
                              No checklist items yet — add the first next step.
                            </p>
                          ) : (
                            <ul class="task-list">
                              {detailApplication.tasks.map((task) => (
                                <li class="task-row" key={task.id}>
                                  <label class="task-check">
                                    <input
                                      type="checkbox"
                                      checked={task.done}
                                      disabled={busyAction === `task-${task.id}`}
                                      onChange={(event) =>
                                        handleToggleTask(task, event.currentTarget.checked)
                                      }
                                    />
                                    <span class={task.done ? 'task-label is-done' : 'task-label'}>
                                      {task.label}
                                    </span>
                                  </label>
                                  <button
                                    type="button"
                                    class="icon-button"
                                    aria-label={`Remove task ${task.label}`}
                                    disabled={busyAction === `task-remove-${task.id}`}
                                    onClick={() => handleRemoveTask(task)}
                                  >
                                    <Icon name="close" size={13} />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <form
                            class="task-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              handleAddTask();
                            }}
                          >
                            <label class="sr-only" for="new-task-input">
                              Add a checklist item
                            </label>
                            <input
                              id="new-task-input"
                              type="text"
                              value={taskDraft}
                              placeholder="Add a checklist item…"
                              maxLength={140}
                              onInput={(event) => setTaskDraft(event.currentTarget.value)}
                            />
                            <button
                              type="submit"
                              class="button button-ghost"
                              disabled={taskDraft.trim().length === 0 || busyAction === 'task-new'}
                            >
                              Add
                            </button>
                          </form>
                        </div>

                        <div class="detail-section">
                          <h3 class="detail-section-title">Application activity</h3>
                          <ActivityFeed
                            entries={applicationActivity}
                            emptyText="Nothing logged for this application yet."
                          />
                        </div>
                      </div>
                      <div class="detail-foot">
                        {confirmDelete ? (
                          <div class="confirm-row" role="alert">
                            <p>
                              Delete “{detailApplication.title}”? This removes its checklist and
                              history.
                            </p>
                            <div class="confirm-actions">
                              <button
                                type="button"
                                class="button button-ghost"
                                onClick={() => setConfirmDelete(false)}
                                disabled={busyAction === 'delete'}
                              >
                                Keep it
                              </button>
                              <button
                                type="button"
                                class="button button-danger"
                                onClick={handleDelete}
                                disabled={busyAction === 'delete'}
                              >
                                {busyAction === 'delete' ? 'Deleting…' : 'Delete application'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            class="button button-danger-ghost"
                            onClick={() => setConfirmDelete(true)}
                          >
                            <Icon name="trash" size={15} />
                            Delete application
                          </button>
                        )}
                      </div>
                    </>
                  ) : detailLoading ? (
                    <div class="detail-skeleton" aria-hidden="true">
                      <div class="line-skeleton is-wide" />
                      <div class="line-skeleton" />
                      <div class="line-skeleton is-short" />
                      <div class="card-skeleton" />
                      <div class="card-skeleton" />
                    </div>
                  ) : (
                    <div class="empty-state detail-empty" role="alert">
                      <span class="state-icon is-error" aria-hidden="true">
                        <Icon name="alert" size={20} />
                      </span>
                      <h3>Could not open this application</h3>
                      <p>{detailError || 'The application is no longer available.'}</p>
                      <button
                        type="button"
                        class="button button-ghost"
                        onClick={() => setDetailReloadToken((token) => token + 1)}
                      >
                        <Icon name="refresh" size={15} />
                        Try again
                      </button>
                    </div>
                  )}
                </aside>
              </div>
            </div>

            <section class="panel activity-panel" id="activity" aria-labelledby="activity-heading">
              <div class="panel-head">
                <div>
                  <h2 class="panel-title" id="activity-heading">
                    Activity
                  </h2>
                  <p class="panel-sub">
                    Every new application, stage move, and checklist update across the workspace.
                  </p>
                </div>
                <span class="panel-badge">{activity.length} recent</span>
              </div>
              <div class="activity-body">
                <ActivityFeed
                  entries={activity}
                  onSelect={openApplication}
                  emptyText="No activity yet. Create an application to get started."
                />
              </div>
            </section>
          </>
        ) : null}

        <footer class="workspace-foot">
          <span>Grantlane · local-first grant pipeline</span>
          <span>Demo clock pinned to {DEMO_TODAY_LABEL}</span>
        </footer>
      </main>

      <div
        class="toast-region"
        aria-live={status?.tone === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        {status ? (
          <div class={status.tone === 'error' ? 'toast is-error' : 'toast'}>
            <span class="toast-icon" aria-hidden="true">
              <Icon name={status.tone === 'error' ? 'alert' : 'check'} size={15} />
            </span>
            <p class="toast-message">{status.message}</p>
          </div>
        ) : null}
      </div>

      <NewApplicationModal
        open={modalOpen}
        busy={createBusy}
        error={createError}
        onClose={closeCreate}
        onSubmit={(draft) => {
          void handleCreate(draft);
        }}
      />
    </div>
  );
}

const mountPoint = document.getElementById('app') ?? document.getElementById('root');

if (!mountPoint) {
  throw new Error('Grantlane could not find the #app mount point.');
}

render(<App />, mountPoint);

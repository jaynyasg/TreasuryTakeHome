import type { Queryable } from "@/lib/db/client";

/** A row from the append-only `audit_events` table. */
export interface AuditEventRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  aggregate_type: string;
  aggregate_id: string;
  before_summary: unknown;
  after_summary: unknown;
  reason: string | null;
  trace_id: string | null;
  source_ip: string | null;
  user_agent: string | null;
  created_at: string;
}

/** Fields accepted when appending an audit event. */
export interface AuditEventInput {
  id: string;
  actorUserId?: string | null;
  action: string;
  aggregateType: string;
  aggregateId: string;
  beforeSummary?: unknown;
  afterSummary?: unknown;
  reason?: string | null;
  traceId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only audit log (plan: "Audit events"). INSERT only — never update or
 * delete. A state change and its audit event should commit in the same
 * service-owned transaction, so this takes a `Queryable`.
 */
export async function appendAuditEvent(
  db: Queryable,
  event: AuditEventInput
): Promise<AuditEventRow> {
  const res = await db.query<AuditEventRow>(
    `insert into audit_events
       (id, actor_user_id, action, aggregate_type, aggregate_id,
        before_summary, after_summary, reason, trace_id, source_ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning *`,
    [
      event.id,
      event.actorUserId ?? null,
      event.action,
      event.aggregateType,
      event.aggregateId,
      event.beforeSummary ?? null,
      event.afterSummary ?? null,
      event.reason ?? null,
      event.traceId ?? null,
      event.sourceIp ?? null,
      event.userAgent ?? null,
    ]
  );
  return res.rows[0];
}

/** List audit events for one aggregate, oldest first (chronological trail). */
export async function listAuditEvents(
  db: Queryable,
  aggregateType: string,
  aggregateId: string
): Promise<AuditEventRow[]> {
  const res = await db.query<AuditEventRow>(
    `select * from audit_events
      where aggregate_type = $1 and aggregate_id = $2
      order by created_at asc`,
    [aggregateType, aggregateId]
  );
  return res.rows;
}
